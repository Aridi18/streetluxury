"""Background-noise continuity.

Recordings made in one session share a characteristic background (room tone,
microphone self-noise, ventilation). When material from another recording or
another moment is spliced in, the background in the pauses on either side of the
splice usually differs. For every candidate time we compare the background-only
frames in the 2 s before and after it: the mean mel spectrum difference (level +
shape) is the raw statistic, and only changes that are large in absolute terms
*and* outliers relative to the recording's own variation are reported.
"""

from __future__ import annotations

import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S

ID = "noise_floor"
VERSION = "1.0"
WINDOW = 200  # frames each side (2 s)
STEP = 5  # evaluate every 50 ms
MIN_BG = 30  # at least 0.3 s of background frames per side


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Background noise continuity",
        family="background",
        version=VERSION,
        method=(
            "Compares the mean mel spectrum of background-only (non-speech) frames in 2 s "
            "windows before and after each instant; reports abrupt changes that are large "
            "(dB) and statistically unusual for this recording (robust z-score)."
        ),
    )
    fr, vad = ctx.frames, ctx.vad
    bg = vad.background
    out.summary["background_seconds"] = float(bg.sum() * FRAME_S)
    if bg.sum() < 2 * MIN_BG or fr.n < 2 * WINDOW:
        out.status = "not_applicable"
        out.status_detail = "Not enough background (non-speech) audio to assess noise continuity."
        return out

    cs, cn = dsp.window_sums(fr.mel_db, bg)
    cse, _ = dsp.window_sums(fr.energy_db, bg)
    grid = np.arange(WINDOW, fr.n - WINDOW, STEP)
    lo, hi = grid - WINDOW, grid + WINDOW
    n_l = cn[grid] - cn[lo]
    n_r = cn[hi] - cn[grid]
    ok = (n_l >= MIN_BG) & (n_r >= MIN_BG)
    with np.errstate(invalid="ignore", divide="ignore"):
        mu_l = (cs[grid] - cs[lo]) / n_l[:, None]
        mu_r = (cs[hi] - cs[grid]) / n_r[:, None]
        e_l = (cse[grid] - cse[lo]) / n_l
        e_r = (cse[hi] - cse[grid]) / n_r
        diff = mu_r - mu_l
        dist = np.sqrt(np.nanmean(diff**2, axis=1))
        level = e_r - e_l
        shape = np.nanstd(diff, axis=1)
    dist = np.where(ok, dist, np.nan)
    valid = np.isfinite(dist)
    out.summary["assessed_fraction"] = float(valid.mean()) if valid.size else 0.0
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Background audio is too fragmented to compare adjacent regions."
        return out

    z = dsp.robust_z(dist, dist[valid])
    out.summary["median_distance_db"] = float(np.nanmedian(dist))
    cond = np.where(valid, dist, -np.inf)
    peaks = dsp.local_peaks(cond, min_distance=int(1.0 / (STEP * FRAME_S)), threshold=p["min_db"])
    for k in peaks:
        if z[k] < p["min_z"]:
            continue
        d = float(dist[k])
        # Uncertainty interval: where the statistic stays within 90% of the peak.
        thr = 0.9 * d
        a = k
        while a > 0 and np.isfinite(dist[a - 1]) and dist[a - 1] >= thr:
            a -= 1
        b = k
        while b < len(dist) - 1 and np.isfinite(dist[b + 1]) and dist[b + 1] >= thr:
            b += 1
        t0, t1 = grid[a] * FRAME_S, grid[b] * FRAME_S
        strength = logistic(d, p["midpoint_db"], p["scale_db"])
        out.candidates.append(
            Candidate(
                detector=ID,
                family="background",
                start=ctx.abs_time(t0),
                end=ctx.abs_time(max(t1, t0 + 0.02)),
                strength=strength,
                measurements={
                    "spectral_distance_db": d,
                    "level_change_db": float(level[k]),
                    "shape_change_db": float(shape[k]),
                    "robust_z": float(z[k]),
                    "background_seconds_before": float(n_l[k] * FRAME_S),
                    "background_seconds_after": float(n_r[k] * FRAME_S),
                },
                explanation=(
                    f"The background noise changes abruptly: the pauses after this point differ "
                    f"from the pauses before it by {d:.1f} dB on average across the spectrum "
                    f"(level change {level[k]:+.1f} dB). This is unusual for this recording "
                    f"(robust z = {z[k]:.1f})."
                ),
                alternatives=[
                    "A background sound starting or stopping (fan, traffic, music).",
                    "The speaker or microphone moving to a different position.",
                    "Adaptive noise suppression or automatic gain control in the recording app.",
                ],
            )
        )
    return out
