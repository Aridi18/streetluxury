"""Electrical Network Frequency (ENF) phase continuity.

Recordings made near mains-powered equipment often capture a faint hum at the
grid frequency (50 or 60 Hz, or a harmonic). The grid frequency wanders slowly,
so within an unedited recording the hum's phase evolves smoothly. A splice
joins two hum signals with unrelated phases.

Method (phase-continuity test): the strongest hum component is demodulated to
baseband; for each instant the hum phase is fitted with a straight line
(constant frequency) over the 2 s before and the 2 s after, with speech frames
down-weighted because speech energy leaks into the band. If both fits are
precise but their extrapolations to the instant disagree, the hum is
discontinuous there. Hum-level changes are measured on background frames only.
The method applies only when a clear hum is present, and says so otherwise.
"""

from __future__ import annotations

import numpy as np
from scipy import signal as sps

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext

ID = "enf"
VERSION = "1.1"
FS = 1000
R = 10  # decimation to 100 Hz (aligned with the 10 ms VAD frames)
RATE = FS / R
W = int(2.0 * RATE)
STEP = int(0.1 * RATE)


def _hum_snr(y: np.ndarray, f: float) -> float:
    nper = min(len(y), 8 * FS)
    freqs, pxx = sps.welch(y, fs=FS, nperseg=nper, noverlap=nper // 2)
    band = (freqs > f - 0.4) & (freqs < f + 0.4)
    ref = ((freqs > f - 6) & (freqs < f - 1.5)) | ((freqs > f + 1.5) & (freqs < f + 6))
    if not band.any() or not ref.any():
        return -np.inf
    return float(10 * np.log10(pxx[band].max() / (np.median(pxx[ref]) + 1e-20)))


def _fit(t: np.ndarray, ph: np.ndarray, w: np.ndarray) -> tuple[float, float, float] | None:
    """Weighted line fit of unwrapped phase; returns (intercept, slope, rms_residual)."""
    sw = w.sum()
    if sw <= 0:
        return None
    ph = np.unwrap(ph)
    tm = (w * t).sum() / sw
    pm = (w * ph).sum() / sw
    var_t = (w * (t - tm) ** 2).sum()
    if var_t <= 0:
        return None
    slope = (w * (t - tm) * (ph - pm)).sum() / var_t
    resid = ph - (pm + slope * (t - tm))
    rms = float(np.sqrt((w * resid**2).sum() / sw))
    return float(pm - slope * tm), float(slope), rms


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Mains hum (ENF) continuity",
        family="enf",
        version=VERSION,
        method=(
            "Detects 50/60 Hz mains hum and harmonics; if present, demodulates the strongest "
            "component and tests phase continuity by comparing straight-line phase fits over the "
            "2 s before and after each instant (speech down-weighted). Hum level is compared on "
            "background frames."
        ),
    )
    if ctx.duration < 10:
        out.status = "not_applicable"
        out.status_detail = "ENF analysis needs at least 10 seconds of audio."
        return out
    y = dsp.resample(ctx.x, ctx.sr, FS).astype(np.float64)
    options = [(50.0 * k, 50.0, k) for k in (1, 2, 3)] + [(60.0 * k, 60.0, k) for k in (1, 2, 3)]
    snrs = [(_hum_snr(y, f), f, nom, k) for f, nom, k in options]
    snr, f_c, nominal, k = max(snrs)
    out.summary.update(
        hum_snr_db=snr if np.isfinite(snr) else None,
        nominal_hz=nominal,
        harmonic=k,
        all_snr_db={f"{f:.0f}": round(s, 1) for s, f, _, _ in snrs if np.isfinite(s)},
    )
    if not np.isfinite(snr) or snr < p["min_snr_db"]:
        out.status = "not_applicable"
        out.status_detail = (
            f"No clear mains hum was found (strongest candidate {snr:.1f} dB above its surroundings); "
            "ENF analysis is not applicable."
        )
        return out

    sos = sps.butter(4, [f_c - 1.0 * k, f_c + 1.0 * k], btype="bandpass", fs=FS, output="sos")
    h = sps.sosfiltfilt(sos, y)
    n = np.arange(len(h))
    base = sps.hilbert(h) * np.exp(-2j * np.pi * f_c * n / FS)
    nb = len(base) // R
    z = base[: nb * R].reshape(nb, R).mean(axis=1)
    amp = np.abs(z)
    ph = np.angle(z)
    speech = np.zeros(nb, dtype=bool)
    m = min(nb, ctx.vad.speech.size)
    speech[:m] = ctx.vad.speech[:m]
    bgmask = np.zeros(nb, dtype=bool)
    bgmask[:m] = ctx.vad.background[:m]
    w_all = amp**2 * np.where(speech, 0.15, 1.0)
    t_all = np.arange(nb) / RATE

    grid = np.arange(W, nb - W, STEP)
    dphi = np.full(grid.size, np.nan)
    score = np.full(grid.size, np.nan)
    sig = np.full(grid.size, np.nan)
    for gi, i in enumerate(grid):
        fl = _fit(t_all[i - W : i], ph[i - W : i], w_all[i - W : i])
        fr = _fit(t_all[i : i + W], ph[i : i + W], w_all[i : i + W])
        if fl is None or fr is None:
            continue
        t0 = t_all[i]
        d = (fl[0] + fl[1] * t0) - (fr[0] + fr[1] * t0)
        d = float(np.angle(np.exp(1j * d)))
        s = fl[2] + fr[2]
        dphi[gi], sig[gi] = d, s
        score[gi] = abs(d) / (s + 0.05)
    valid = np.isfinite(score)
    if valid.sum() < 5:
        out.status = "not_applicable"
        out.status_detail = "Hum too unstable to track."
        return out
    out.summary["median_phase_noise_rad"] = float(np.nanmedian(sig))
    out.summary["median_continuity_score"] = float(np.nanmedian(score))
    peaks = dsp.local_peaks(np.where(valid, score, -np.inf), min_distance=int(1.0 * RATE / STEP), threshold=4.0)
    snr_factor = min(1.0, (snr - 5.0) / 15.0)
    for gi in peaks:
        if abs(dphi[gi]) < 0.6:
            continue
        t = grid[gi] / RATE
        strength = min(0.92, logistic(float(score[gi]), 6.0, 1.5)) * snr_factor
        out.candidates.append(
            Candidate(
                detector=ID,
                family="enf",
                start=ctx.abs_time(max(0.0, t - 0.1)),
                end=ctx.abs_time(t + 0.1),
                strength=strength,
                measurements={
                    "phase_jump_rad": float(dphi[gi]),
                    "phase_noise_rad": float(sig[gi]),
                    "continuity_score": float(score[gi]),
                    "hum_snr_db": snr,
                    "component_hz": f_c,
                },
                explanation=(
                    f"The {nominal:.0f} Hz mains hum (measured at {f_c:.0f} Hz, {snr:.0f} dB above its "
                    f"surroundings) jumps in phase by {np.degrees(dphi[gi]):+.0f}° here, while the hum "
                    f"before and after is steady (phase noise {np.degrees(sig[gi]):.0f}°). Grid hum "
                    "evolves continuously, so a phase jump is a classic sign of a splice."
                ),
                alternatives=[
                    "Low-frequency speech or handling noise in the same band.",
                    "A nearby device switching on or off.",
                ],
            )
        )

    # Hum level changes measured only on background frames.
    amp_db = 20 * np.log10(amp + 1e-12)
    lvl_idx, lvl_d = [], []
    for i in grid[:: max(1, int(0.2 * RATE / STEP))]:
        lm, rm = bgmask[i - W : i], bgmask[i : i + W]
        if lm.sum() < 50 or rm.sum() < 50:
            continue
        lvl_idx.append(i)
        lvl_d.append(float(np.median(amp_db[i : i + W][rm]) - np.median(amp_db[i - W : i][lm])))
    if lvl_d:
        arr = np.abs(np.asarray(lvl_d))
        for j in dsp.local_peaks(arr, min_distance=10, threshold=8.0):
            i, d = lvl_idx[j], lvl_d[j]
            t = i / RATE
            out.candidates.append(
                Candidate(
                    detector=ID,
                    family="enf",
                    start=ctx.abs_time(max(0.0, t - 0.3)),
                    end=ctx.abs_time(t + 0.3),
                    strength=min(0.6, logistic(abs(d), 12.0, 3.0)) * snr_factor,
                    measurements={"hum_level_change_db": d, "hum_snr_db": snr},
                    explanation=(
                        f"In the pauses, the mains hum level changes by {d:+.1f} dB and stays changed, "
                        "as when material recorded in a different place is inserted."
                    ),
                    alternatives=["Equipment near the recorder switching on or off."],
                )
            )
    return out
