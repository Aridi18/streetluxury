"""Acoustic (channel) change detection with the Bayesian Information Criterion.

For every candidate instant, the cepstral features (MFCC 1-12) of the speech in
the 3 s before and after are modelled either as one Gaussian or as two. A large
positive ΔBIC means the two sides are better explained by different acoustic
conditions (microphone, room, distance, codec). Speaker changes in a
conversation produce the same signature, so this detector is capped at a low
strength and only escalates a finding when other families agree.
"""

from __future__ import annotations

import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S

ID = "spectral_change"
VERSION = "1.0"
WIN = 300  # speech frames per side (3 s of speech)
MIN_SIDE = 100
STEP = 25
DIM = 12


def _logdet(cov: np.ndarray) -> float:
    sign, ld = np.linalg.slogdet(cov + np.eye(cov.shape[0]) * 1e-6)
    return float(ld) if sign > 0 else np.inf


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Acoustic change (ΔBIC)",
        family="spectral",
        version=VERSION,
        method=(
            "Bayesian Information Criterion change detection on MFCC 1–12 of speech frames "
            "(3 s each side); reports statistically unusual acoustic-condition changes."
        ),
    )
    sp_idx = np.flatnonzero(ctx.vad.speech)
    if sp_idx.size < 2 * MIN_SIDE + 50:
        out.status = "not_applicable"
        out.status_detail = "Not enough speech for acoustic change detection."
        return out
    feats = ctx.frames.mfcc[sp_idx, 1 : DIM + 1].astype(np.float64)
    feats = (feats - feats.mean(axis=0)) / (feats.std(axis=0) + 1e-6)
    n = feats.shape[0]
    cs = np.concatenate([np.zeros((1, DIM)), np.cumsum(feats, axis=0)])
    outer = np.einsum("ni,nj->nij", feats, feats)
    cso = np.concatenate([np.zeros((1, DIM, DIM)), np.cumsum(outer, axis=0)])
    del outer

    def cov(a: int, b: int) -> np.ndarray:
        m = b - a
        mu = (cs[b] - cs[a]) / m
        return (cso[b] - cso[a]) / m - np.outer(mu, mu)

    penalty_terms = 0.5 * (DIM + 0.5 * DIM * (DIM + 1))
    grid = np.arange(MIN_SIDE, n - MIN_SIDE, STEP)
    score = np.full(grid.size, np.nan)
    for gi, k in enumerate(grid):
        a, b = max(0, k - WIN), min(n, k + WIN)
        # Do not let a window straddle a long pause (> 2 s): different utterances
        # separated by long gaps are compared by the background detector instead.
        if (sp_idx[k] - sp_idx[a]) * FRAME_S > 8.0 or (sp_idx[b - 1] - sp_idx[k]) * FRAME_S > 8.0:
            continue
        n1, n2 = k - a, b - k
        if n1 < MIN_SIDE or n2 < MIN_SIDE:
            continue
        N = n1 + n2
        d = 0.5 * (N * _logdet(cov(a, b)) - n1 * _logdet(cov(a, k)) - n2 * _logdet(cov(k, b)))
        d -= penalty_terms * np.log(N)
        score[gi] = d / N  # per-frame gain, comparable across window sizes
    valid = np.isfinite(score)
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Speech is too fragmented for acoustic change detection."
        return out
    z = dsp.robust_z(score, score[valid])
    out.summary["median_dbic_per_frame"] = float(np.nanmedian(score))
    peaks = dsp.local_peaks(np.where(valid, score, -np.inf), min_distance=8, threshold=0.0)
    for gi in peaks:
        if z[gi] < p["min_z"]:
            continue
        t = sp_idx[grid[gi]] * FRAME_S
        s = min(p["max_strength"], logistic(float(score[gi]), p["midpoint"], p["scale"]))
        out.candidates.append(
            Candidate(
                detector=ID,
                family="spectral",
                start=ctx.abs_time(max(0.0, t - 0.15)),
                end=ctx.abs_time(t + 0.15),
                strength=s,
                measurements={"dbic_per_frame": float(score[gi]), "robust_z": float(z[gi])},
                explanation=(
                    "The spectral character of the speech changes here more than elsewhere in "
                    f"this recording (ΔBIC {score[gi]:.2f} per frame, robust z = {z[gi]:.1f}), "
                    "consistent with a change of microphone, room, distance or encoding."
                ),
                alternatives=[
                    "A different person starts speaking.",
                    "The same speaker changes voice quality (shouting, whispering, laughing).",
                ],
            )
        )
    return out
