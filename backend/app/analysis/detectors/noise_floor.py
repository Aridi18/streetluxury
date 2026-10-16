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
VERSION = "1.1"
K = 30  # background frames compared on each side (0.3 s)
MAX_SPAN = 600  # ...gathered from at most 6 s before / after the instant


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Background noise continuity",
        family="background",
        version=VERSION,
        method=(
            "Compares the mel spectrum of the nearest 0.3 s of background-only (non-speech) frames "
            "before and after each instant (gathered from at most 6 s away), band by band relative to "
            "the frames' own variability; reports changes that are large (median dB over bands), "
            "statistically significant and unusual for this recording (robust z-score)."
        ),
    )
    fr, vad = ctx.frames, ctx.vad
    bidx = np.flatnonzero(vad.background)
    nb = bidx.size
    out.summary["background_seconds"] = float(nb * FRAME_S)
    if nb < 2 * K + 5:
        out.status = "not_applicable"
        out.status_detail = "Not enough background (non-speech) audio to assess noise continuity."
        return out

    mel = fr.mel_db[bidx].astype(np.float64)
    en = fr.energy_db[bidx].astype(np.float64)
    cs = np.concatenate([np.zeros((1, mel.shape[1])), np.cumsum(mel, axis=0)])
    cs2 = np.concatenate([np.zeros((1, mel.shape[1])), np.cumsum(mel**2, axis=0)])
    ce = np.concatenate([[0.0], np.cumsum(en)])
    # Split positions j: left = background frames [j-K, j), right = [j, j+K).
    j = np.arange(K, nb - K + 1)
    span_l = bidx[j - 1] - bidx[j - K]
    span_r = bidx[j + K - 1] - bidx[j]
    gap = bidx[j] - bidx[j - 1]
    ok = (span_l <= MAX_SPAN) & (span_r <= MAX_SPAN) & (gap <= MAX_SPAN)
    mu_l = (cs[j] - cs[j - K]) / K
    mu_r = (cs[j + K] - cs[j]) / K
    var_l = np.maximum((cs2[j] - cs2[j - K]) / K - mu_l**2, 0.0)
    var_r = np.maximum((cs2[j + K] - cs2[j]) / K - mu_r**2, 0.0)
    diff = mu_r - mu_l
    # Only bands with real content on at least one side (near-silent bands are pure jitter).
    live = np.maximum(mu_l, mu_r) > -100.0
    # Frames are correlated; treat ~1/3 of them as independent.
    t_band = np.abs(diff) / np.sqrt((var_l + var_r) / (K / 3.0) + 0.25)
    absd = np.where(live, np.abs(diff), np.nan)
    with np.errstate(invalid="ignore"):
        dist = np.nanmedian(absd, axis=1)  # robust typical change across bands (dB)
        tstat = np.nanmedian(np.where(live, t_band, np.nan), axis=1)
    level = (ce[j + K] - ce[j]) / K - (ce[j] - ce[j - K]) / K
    shape = np.nanstd(np.where(live, diff, np.nan), axis=1)
    ok &= live.sum(axis=1) >= 8
    dist_raw = np.where(ok, dist, np.nan)
    signif = tstat >= 2.5
    dist = np.where(ok & signif, dist, np.where(ok, 0.0, np.nan))
    valid = np.isfinite(dist)
    out.summary["assessed_fraction"] = float(valid.mean()) if valid.size else 0.0
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Background audio is too fragmented to compare adjacent regions."
        return out

    # Unusualness is judged against the raw distances at all assessable positions.
    z = dsp.robust_z(dist_raw, dist_raw[np.isfinite(dist_raw)])
    # Noise gates / noise suppression switch pauses between near-silence and room tone, which
    # looks like a background change at every gated pause. Detect the pattern and down-weight.
    bg_level = en
    gated_frac = float(np.mean(bg_level < -85.0))
    gated = 0.1 < gated_frac < 0.9 and float(np.percentile(bg_level, 90)) > -75.0
    out.summary["near_silent_background_fraction"] = gated_frac
    out.summary["noise_gate_suspected"] = gated
    out.summary["median_distance_db"] = float(np.nanmedian(dist))
    cond = np.where(valid, dist, -np.inf)
    peaks = dsp.local_peaks(cond, min_distance=K, threshold=p["min_db"])
    for k in peaks:
        if z[k] < p["min_z"]:
            continue
        d = float(dist[k])
        # The change lies between the last background frame before and the first after the split.
        t0 = (bidx[j[k] - 1] + 1) * FRAME_S
        t1 = bidx[j[k]] * FRAME_S
        strength = logistic(d, p["midpoint_db"], p["scale_db"])
        if t1 - t0 > 4.0:
            strength *= 0.7  # the change could be anywhere in a long stretch of speech
        if gated:
            strength *= 0.35
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
                    "median_band_t": float(tstat[k]),
                    "background_compared_s": K * FRAME_S,
                    "uncertainty_s": float(t1 - t0),
                },
                explanation=(
                    f"The background noise changes abruptly: the pauses after this point differ "
                    f"from the pauses before it by {d:.1f} dB on average across the spectrum "
                    f"(median over frequency bands; level change {level[k]:+.1f} dB). This is unusual for this recording "
                    f"(robust z = {z[k]:.1f})."
                ),
                alternatives=[
                    *(
                        [
                            "Noise gating or noise suppression is active in this recording (some pauses are "
                            "near-silent, others contain room tone), which produces similar changes."
                        ]
                        if gated
                        else []
                    ),
                    "A background sound starting or stopping (fan, traffic, music).",
                    "The speaker or microphone moving to a different position.",
                    "Adaptive noise suppression or automatic gain control in the recording app.",
                ],
            )
        )
    return out
