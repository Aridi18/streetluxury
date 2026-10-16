"""Speech level steps and pitch (F0) jumps.

Both are weak evidence on their own: people change loudness and intonation all
the time. They are useful as *supporting* signals at an instant where another
family (background, bandwidth, waveform) already shows a discontinuity, and are
capped accordingly.
"""

from __future__ import annotations

import librosa
import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S, SR16

LEVEL_ID = "level"
PITCH_ID = "pitch"
VERSION = "1.0"


def run_level(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params("level_dc")
    out = DetectorOutput(
        id=LEVEL_ID,
        name="Speech level steps",
        family="prosody",
        version=VERSION,
        method=(
            "Compares the median level of the louder half of speech frames in 2.5 s windows "
            "before and after each instant."
        ),
    )
    sp = ctx.vad.speech
    e = ctx.frames.energy_db
    if sp.sum() < 200:
        out.status = "not_applicable"
        out.status_detail = "Not enough speech."
        return out
    W, step = 250, 10
    grid = np.arange(W, len(e) - W, step)
    diff = np.full(grid.size, np.nan)
    for gi, k in enumerate(grid):
        lft = e[k - W : k][sp[k - W : k]]
        rgt = e[k : k + W][sp[k : k + W]]
        if lft.size < 60 or rgt.size < 60:
            continue
        diff[gi] = float(np.percentile(rgt, 75) - np.percentile(lft, 75))
    valid = np.isfinite(diff)
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Speech too fragmented."
        return out
    ad = np.abs(np.where(valid, diff, 0.0))
    z = dsp.robust_z(ad, ad[valid])
    for gi in dsp.local_peaks(ad, min_distance=20, threshold=p["level_midpoint_db"] - 2 * p["level_scale_db"]):
        if z[gi] < 4:
            continue
        t = grid[gi] * FRAME_S
        s = min(p["level_max_strength"], logistic(ad[gi], p["level_midpoint_db"], p["level_scale_db"]))
        out.candidates.append(
            Candidate(
                detector=LEVEL_ID,
                family="prosody",
                start=ctx.abs_time(max(0.0, t - 0.2)),
                end=ctx.abs_time(t + 0.2),
                strength=s,
                measurements={"speech_level_change_db": float(diff[gi]), "robust_z": float(z[gi])},
                explanation=(
                    f"The speech level steps by {diff[gi]:+.1f} dB between the speech before and "
                    "after this point and stays there."
                ),
                alternatives=[
                    "The speaker moving closer to or away from the microphone.",
                    "A different, louder or quieter, speaker.",
                    "Automatic gain control.",
                ],
            )
        )
    return out


def run_pitch(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params("pitch")
    out = DetectorOutput(
        id=PITCH_ID,
        name="Pitch continuity",
        family="prosody",
        version=VERSION,
        method=(
            "Tracks F0 with probabilistic YIN (20 ms hop) and reports step changes of several "
            "semitones inside continuous voicing, excluding octave errors."
        ),
    )
    if ctx.vad.speech_seconds < 1.0:
        out.status = "not_applicable"
        out.status_detail = "Not enough speech for pitch tracking."
        return out
    hop = 320
    f0, voiced, prob = _pyin_speech_only(ctx, hop)
    st = 12 * np.log2(np.where(voiced, f0, np.nan) / 100.0)
    out.summary["voiced_seconds"] = float(np.sum(voiced) * hop / SR16)
    if out.summary["voiced_seconds"] < 0.5:
        out.status = "not_applicable"
        out.status_detail = "Too little voiced speech."
        return out
    k_ctx = 4  # 80 ms each side
    for i in range(k_ctx, len(st) - k_ctx):
        if not (voiced[i - 1] and voiced[i]) or prob[i] < 0.6 or prob[i - 1] < 0.6:
            continue
        jump = st[i] - st[i - 1]
        if abs(jump) < p["min_st"]:
            continue
        if abs(abs(jump) - 12) < 1.5 or abs(abs(jump) - 7) < 0.7:
            continue  # octave / fifth tracking errors
        left = st[i - k_ctx : i]
        right = st[i : i + k_ctx]
        if np.isnan(left).any() or np.isnan(right).any():
            continue
        if left.std() > 1.5 or right.std() > 1.5:
            continue
        step = float(np.median(right) - np.median(left))
        if abs(step) < p["min_st"] - 0.5:
            continue
        t = i * hop / SR16
        s = min(p["max_strength"], logistic(abs(step), p["midpoint_st"], p["scale_st"]))
        out.candidates.append(
            Candidate(
                detector=PITCH_ID,
                family="prosody",
                start=ctx.abs_time(max(0.0, t - 0.04)),
                end=ctx.abs_time(t + 0.04),
                strength=s,
                measurements={
                    "pitch_step_semitones": step,
                    "f0_before_hz": float(100 * 2 ** (np.median(left) / 12)),
                    "f0_after_hz": float(100 * 2 ** (np.median(right) / 12)),
                },
                explanation=(
                    f"The voice pitch jumps by {step:+.1f} semitones within 20 ms while the voice "
                    "keeps sounding. Natural intonation moves continuously; a jump inside a voiced "
                    "sound can indicate two recordings joined mid-word."
                ),
                alternatives=["Voice breaks, creaky voice or laughter.", "Pitch tracking error."],
            )
        )
    return out


def _pyin_speech_only(ctx: AnalysisContext, hop: int):
    """Run pYIN only on speech segments (much faster than the whole file)."""
    n = 1 + len(ctx.x16) // hop
    f0 = np.full(n, np.nan)
    voiced = np.zeros(n, dtype=bool)
    prob = np.zeros(n)
    for a, b in ctx.vad.segments:
        s0, s1 = int(a * SR16), int(b * SR16)
        if s1 - s0 < 2048:
            continue
        f, v, pr = librosa.pyin(
            ctx.x16[s0:s1],
            fmin=60,
            fmax=500,
            sr=SR16,
            frame_length=1024,
            hop_length=hop,
            center=True,
            resolution=0.25,
            n_thresholds=30,
        )
        i0 = s0 // hop
        m = min(len(f), n - i0)
        f0[i0 : i0 + m] = f[:m]
        voiced[i0 : i0 + m] = v[:m]
        prob[i0 : i0 + m] = pr[:m]
    return f0, voiced, prob
