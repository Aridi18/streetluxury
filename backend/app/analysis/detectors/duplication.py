"""Duplicated (copy–pasted) audio within one recording.

Natural speech never repeats exactly: even the same word spoken twice differs
in timing and waveform. A stretch of audio that matches another stretch of the
same recording in both its fingerprint (bit error rate) *and* its waveform
(normalised cross-correlation) was almost certainly copied. Sample-identical
copies are reported as such.
"""

from __future__ import annotations

import numpy as np

from .. import fingerprint as fp
from ..base import Candidate, DetectorOutput
from ..calibration import edit_params
from ..context import AnalysisContext

ID = "duplication"
VERSION = "1.0"
FS = fp.HOP / fp.SR  # 10 ms


def _xcorr_peak(a: np.ndarray, b: np.ndarray, max_lag: int) -> tuple[float, int]:
    """Max normalised correlation of a against b shifted by -max_lag..max_lag."""
    best, best_lag = -1.0, 0
    na = np.linalg.norm(a) + 1e-12
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            x, y = a[lag:], b[: len(b) - lag] if lag else b
        else:
            x, y = a[:lag], b[-lag:]
        m = min(len(x), len(y))
        if m < 100:
            continue
        x, y = x[:m], y[:m]
        c = float(np.dot(x, y) / ((np.linalg.norm(x) + 1e-12) * (np.linalg.norm(y) + 1e-12)))
        if c > best:
            best, best_lag = c, lag
    _ = na
    return best, best_lag


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Duplicated segments",
        family="duplication",
        version=VERSION,
        method=(
            "Robust 32-bit audio fingerprints (10 ms frames) are matched against the same "
            "recording by hash voting; candidate repeats are verified by bit error rate and "
            "waveform cross-correlation, and checked for sample-exact identity."
        ),
    )
    if ctx.duration < 2 * p["min_seconds"] + 0.5:
        out.status = "not_applicable"
        out.status_detail = "Recording too short."
        return out
    prints = fp.compute(ctx.x16)
    ctx.cache["fingerprints"] = prints
    min_len = int(p["min_seconds"] / FS)
    votes = fp.offset_votes(prints, prints, same_signal=True, min_lag=min_len)
    matches = fp.matched_regions(prints, prints, votes, max_ber=p["max_ber"] + 0.05, min_len=min_len)
    out.summary["candidate_repeats"] = len(matches)
    seen: list[tuple[int, int, int]] = []
    for m in matches:
        length = m.q_end - m.q_start
        if m.offset < length:
            continue  # overlapping repeat: periodic sound (hum, tone, sustained vowel)
        if m.ber > p["max_ber"]:
            continue
        if any(abs(m.q_start - a) < 20 and abs(m.offset - o) < 20 for a, _, o in seen):
            continue
        seen.append((m.q_start, m.q_end, m.offset))
        s0 = m.q_start * fp.HOP
        s1 = m.q_end * fp.HOP
        d0 = (m.q_start + m.offset) * fp.HOP
        a = ctx.x16[s0:s1].astype(np.float64)
        b = ctx.x16[d0 : d0 + (s1 - s0)].astype(np.float64)
        if b.size < a.size or a.size < 400:
            continue
        corr, lag = _xcorr_peak(b, a, max_lag=fp.HOP)
        if corr < p["min_corr"]:
            continue
        exact = _sample_identical(ctx, s0 / fp.SR, (d0 + lag) / fp.SR, (s1 - s0) / fp.SR)
        src = (ctx.abs_time(s0 / fp.SR), ctx.abs_time(s1 / fp.SR))
        dst = (ctx.abs_time((d0 + lag) / fp.SR), ctx.abs_time((d0 + lag + s1 - s0) / fp.SR))
        strength = float(np.clip(0.55 + 0.45 * (corr - 0.6) / 0.35, 0.55, 0.98))
        if exact:
            strength = 0.99
        dur = (s1 - s0) / fp.SR
        out.candidates.append(
            Candidate(
                detector=ID,
                family="duplication",
                kind="pair",
                start=dst[0],
                end=dst[1],
                strength=strength,
                measurements={
                    "duration_s": dur,
                    "fingerprint_bit_error_rate": m.ber,
                    "waveform_correlation": corr,
                    "sample_identical": exact,
                    "source_start": src[0],
                    "source_end": src[1],
                },
                related={"source_start": src[0], "source_end": src[1]},
                explanation=(
                    f"{dur:.2f} s of audio here repeats audio from {_fmt(src[0])}–{_fmt(src[1])} "
                    f"(waveform correlation {corr:.2f}, fingerprint bit error rate {m.ber:.2f}"
                    + ("; the samples are identical" if exact else "")
                    + "). Natural speech does not repeat this precisely; the segment appears to have "
                    "been copied."
                ),
                alternatives=[
                    "Repeated music, ringtones, notification sounds or automated announcements.",
                    "Audio played back from a recording during the conversation.",
                ],
            )
        )
    return out


def _sample_identical(ctx: AnalysisContext, t_src: float, t_dst: float, dur: float) -> bool:
    sr = ctx.sr
    n = int(dur * sr)
    s0 = int(round(t_src * sr))
    for d in range(-3, 4):
        d0 = int(round(t_dst * sr)) + d * max(1, sr // 16000)
        for fine in range(-(sr // 16000), sr // 16000 + 1):
            j = d0 + fine
            if j < 0 or j + n > len(ctx.x) or s0 + n > len(ctx.x):
                continue
            a = ctx.x[s0 : s0 + n]
            b = ctx.x[j : j + n]
            if np.max(np.abs(a)) > 1e-3 and np.max(np.abs(a - b)) < 1e-6:
                return True
    return False


def _fmt(t: float) -> str:
    m, s = divmod(max(0.0, t), 60)
    return f"{int(m):02d}:{s:05.2f}"
