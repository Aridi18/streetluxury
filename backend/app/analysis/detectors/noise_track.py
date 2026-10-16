"""Noise-floor tracking through speech (minimum statistics).

The pause-based background check needs pauses on both sides of an edit. Inserted
material is often short and continuous speech, so this check follows the noise
floor *through* speech instead: in every mel band, the minimum level over
0.4 s windows tracks the quietest moments between sounds, which in a noisy
recording sit on the noise floor (Martin's minimum-statistics principle). We
compare the typical per-band minima in the 1.5 s before and after each instant;
a sustained jump means the material on each side carries a different noise floor.
"""

from __future__ import annotations

import numpy as np
from scipy import ndimage

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S

ID = "noise_track"
VERSION = "1.0"
MIN_WIN = 40  # 0.4 s minimum-statistics window
SIDE = 150  # 1.5 s each side
STEP = 5


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Noise floor through speech",
        family="background",
        version=VERSION,
        method=(
            "Tracks the per-band noise floor through speech with minimum statistics (0.4 s minima of "
            "the mel spectrum) and compares the 1.5 s before and after each instant; reports sustained, "
            "statistically unusual jumps."
        ),
    )
    fr = ctx.frames
    if fr.n < 2 * SIDE + MIN_WIN:
        out.status = "not_applicable"
        out.status_detail = "Recording too short for noise-floor tracking."
        return out
    mel = np.where(ctx.vad.digital_silence[:, None], np.nan, fr.mel_db.astype(np.float64))
    filled = np.where(np.isnan(mel), np.inf, mel)
    mins = ndimage.minimum_filter1d(filled, size=MIN_WIN, axis=0, mode="nearest")
    mins = np.where(np.isfinite(mins), mins, np.nan)
    live_band = np.nanmedian(mins, axis=0) > -100.0
    if live_band.sum() < 8:
        out.status = "not_applicable"
        out.status_detail = "The recording has no measurable noise floor."
        return out
    m = mins[:, live_band]
    cs = np.concatenate([np.zeros((1, m.shape[1])), np.nancumsum(m, axis=0)])
    cn = np.concatenate([np.zeros((1, m.shape[1])), np.cumsum(np.isfinite(m), axis=0)])
    cs2 = np.concatenate([np.zeros((1, m.shape[1])), np.nancumsum(m**2, axis=0)])
    grid = np.arange(SIDE, fr.n - SIDE, STEP)
    lo, hi = grid - SIDE, grid + SIDE
    with np.errstate(invalid="ignore", divide="ignore"):
        nl = cn[grid] - cn[lo]
        nr = cn[hi] - cn[grid]
        mu_l = (cs[grid] - cs[lo]) / nl
        mu_r = (cs[hi] - cs[grid]) / nr
        var_l = np.maximum((cs2[grid] - cs2[lo]) / nl - mu_l**2, 0)
        var_r = np.maximum((cs2[hi] - cs2[grid]) / nr - mu_r**2, 0)
        diff = mu_r - mu_l
        # Minima are strongly correlated over MIN_WIN frames: effective sample size SIDE / MIN_WIN.
        t_band = np.abs(diff) / np.sqrt((var_l + var_r) / (SIDE / MIN_WIN) + 0.25)
        dist = np.nanmedian(np.abs(diff), axis=1)
        tstat = np.nanmedian(t_band, axis=1)
        level = np.nanmedian(diff, axis=1)
    valid = np.isfinite(dist)
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Not enough audio to track the noise floor."
        return out
    z = dsp.robust_z(dist, dist[valid])
    out.summary["median_floor_change_db"] = float(np.nanmedian(dist))
    score = np.where(valid & (tstat >= p["min_t"]), dist, -np.inf)
    for k in dsp.local_peaks(score, min_distance=int(0.8 / (STEP * FRAME_S)), threshold=p["min_db"]):
        if z[k] < p["min_z"]:
            continue
        t = grid[k] * FRAME_S
        d = float(dist[k])
        out.candidates.append(
            Candidate(
                detector=ID,
                family="background",
                start=ctx.abs_time(max(0.0, t - 0.2)),
                end=ctx.abs_time(t + 0.2),
                strength=logistic(d, p["midpoint_db"], p["scale_db"]),
                measurements={
                    "floor_change_db": float(level[k]),
                    "median_band_change_db": d,
                    "median_band_t": float(tstat[k]),
                    "robust_z": float(z[k]),
                },
                explanation=(
                    f"The noise floor between sounds jumps by {level[k]:+.1f} dB (median over frequency "
                    f"bands) at this point and stays there, although speech continues. Material recorded in "
                    "one place keeps a steady noise floor; a jump suggests audio from another recording."
                ),
                alternatives=[
                    "A noise source (fan, traffic, music) starting or stopping.",
                    "Adaptive noise suppression or gain control in the recording chain.",
                ],
            )
        )
    return out
