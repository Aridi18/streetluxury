"""Digital silence inside a recording that otherwise has a noise floor.

Microphones always produce some noise, so stretches of exact (or 1-LSB) digital
silence in the middle of a recording usually mean samples were generated rather
than captured: a deleted section replaced with silence, or a pause inserted in an
editor. Noise gates and voice-call DTX also produce silence, but they do so in
most pauses; when the majority of pauses are gated we report a processing
pattern instead of individual edits.
"""

from __future__ import annotations

import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S

ID = "digital_silence"
VERSION = "1.0"
LSB16 = 1.0 / 32768.0


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Digital silence",
        family="waveform",
        version=VERSION,
        method=(
            "Finds runs of samples within ±1 LSB (16-bit) lasting at least 10 ms inside the "
            "recording, and checks whether the rest of the recording has a real noise floor."
        ),
    )
    x, sr = ctx.x, ctx.sr
    quiet = np.abs(x) <= LSB16 * 1.01
    min_len = int(p["min_ms"] / 1000 * sr)
    runs = [(a, b) for a, b in dsp.bool_runs(quiet) if b - a >= min_len]
    edge = int(0.25 * sr)
    inner = [(a, b) for a, b in runs if a > edge and b < len(x) - edge]
    out.summary["runs_total"] = len(runs)
    out.summary["runs_inside"] = len(inner)
    bg = ctx.vad.background
    bg_level = float(np.median(ctx.frames.energy_db[bg])) if bg.sum() > 20 else None
    out.summary["background_level_dbfs"] = bg_level
    if not inner:
        return out
    if bg_level is None or bg_level < -90.0:
        out.status = "not_applicable"
        out.status_detail = (
            "The recording has no measurable background noise, so digital silence is expected "
            "(typical of studio, synthetic or heavily processed audio)."
        )
        return out

    # How many natural pauses (>= 200 ms non-speech) contain digital silence?
    pauses = [(a, b) for a, b in dsp.bool_runs(~ctx.vad.speech) if (b - a) >= 20]
    gated = 0
    for a, b in pauses:
        s0, s1 = int(a * FRAME_S * sr), int(b * FRAME_S * sr)
        if any(r0 < s1 and r1 > s0 for r0, r1 in inner):
            gated += 1
    gate_fraction = gated / len(pauses) if pauses else 0.0
    out.summary["pauses"] = len(pauses)
    out.summary["pauses_with_digital_silence"] = gated
    pattern = gate_fraction >= p["gate_fraction"] and gated >= 3
    if pattern:
        out.summary["processing_pattern"] = (
            f"{gated} of {len(pauses)} pauses contain digital silence, consistent with a noise gate, "
            "voice-call DTX or similar processing rather than individual edits."
        )

    for a, b in inner:
        dur = (b - a) / sr
        pre = np.abs(x[max(0, a - sr // 1000) : a])
        post = np.abs(x[b : b + sr // 1000])
        hard_in = pre.size > 0 and float(pre.max()) > 20 * LSB16
        hard_out = post.size > 0 and float(post.max()) > 20 * LSB16
        strength = 0.6 + 0.1 * hard_in + 0.1 * hard_out + (0.1 if dur >= 0.1 else 0.0)
        if pattern:
            strength = 0.15
        out.candidates.append(
            Candidate(
                detector=ID,
                family="waveform",
                kind="interval",
                start=ctx.abs_time(a / sr),
                end=ctx.abs_time(b / sr),
                strength=strength,
                measurements={
                    "duration_ms": dur * 1000,
                    "abrupt_start": hard_in,
                    "abrupt_end": hard_out,
                    "background_level_dbfs": bg_level,
                    "gate_pattern": pattern,
                },
                explanation=(
                    f"{dur * 1000:.0f} ms of digital silence inside a recording whose background noise "
                    f"is around {bg_level:.0f} dBFS. "
                    + ("The transition into the silence is abrupt. " if hard_in or hard_out else "")
                    + (
                        "Because most pauses are silenced this way, it is more likely a processing "
                        "pattern than an edit."
                        if pattern
                        else "Captured audio does not normally contain exact silence; this is "
                        "consistent with an edited pause or a deleted section."
                    )
                ),
                alternatives=[
                    "A noise gate, voice-call DTX or 'silence removal' feature in the recording app.",
                    "Packet loss concealment in a VoIP call.",
                ],
            )
        )
    return out
