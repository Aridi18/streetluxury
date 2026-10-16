"""Bandwidth / codec cutoff consistency.

Every recording chain (microphone, phone network, codec, resampler) imposes a
characteristic upper frequency limit, visible as a steep "cliff" in the long-term
spectrum. Audio assembled from different sources often switches between cutoffs
(e.g. a narrowband 4 kHz phone segment inside 16 kHz audio). We track the cliff
frequency in 1 s windows of speech and report persistent shifts.

Some codecs (Opus, and AAC at low bit rates) legitimately switch bandwidth
during a file; for those the evidence is down-weighted and the caveat stated.
"""

from __future__ import annotations

import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S

ID = "bandwidth"
VERSION = "1.2"
ADAPTIVE_CODECS = {"opus": 0.4, "aac": 0.6, "amr_nb": 0.5, "amr_wb": 0.5, "vorbis": 0.7}


def _smooth_freq(l_db: np.ndarray, bins: int) -> np.ndarray:
    return dsp.moving_average(l_db, bins)


def find_cutoff(ltas_db: np.ndarray, freqs: np.ndarray, cliff_db: float) -> tuple[float, float]:
    """Return (cutoff_hz, cliff_depth_db). cutoff = Nyquist when no cliff is found.

    A cliff is a drop of at least ``cliff_db`` within 500 Hz, above which the
    spectrum stays flat (a filter's stop band) rather than showing speech structure.
    """
    nyq = float(freqs[-1])
    df = float(freqs[1] - freqs[0])
    half = max(1, int(round(250.0 / df)))
    sm = _smooth_freq(ltas_db, max(1, int(round(150.0 / df))))
    n = sm.size
    drop = np.full(n, -np.inf)
    drop[half : n - half] = sm[: n - 2 * half] - sm[2 * half :]
    valid = (freqs >= 2500.0) & (freqs <= nyq - 600.0)
    cand = np.flatnonzero(valid & (drop >= cliff_db))
    if cand.size == 0:
        return nyq, 0.0
    groups = np.split(cand, np.flatnonzero(np.diff(cand) > 1) + 1)
    for g in reversed(groups):  # highest cliff first
        k = int(g[np.argmax(drop[g])])
        stop = sm[min(n - 1, k + half) : min(n, k + half + int(round(1500.0 / df)))]
        below_level = sm[max(0, k - half)]
        if stop.size < 3:
            continue
        if float(np.mean(stop)) > below_level - cliff_db or float(np.std(stop)) > 4.0:
            continue  # energy or structure continues above: not a filter cliff
        return float(freqs[k]), float(drop[k])
    return nyq, 0.0


def _band_db(ltas: np.ndarray, freqs: np.ndarray, lo: float, hi: float) -> float | None:
    m = (freqs >= lo) & (freqs <= hi)
    if m.sum() < 2:
        return None
    return float(np.mean(dsp.db(ltas[m])))


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Bandwidth consistency",
        family="spectral",
        version=VERSION,
        method=(
            "Estimates the upper-frequency cutoff (steep spectral cliff above which even the "
            "background is absent) in 1 s windows at the native sample rate and reports persistent, "
            "spectrally confirmed cutoff shifts."
        ),
    )
    sr = ctx.sr
    if sr < 16000:
        out.status = "not_applicable"
        out.status_detail = f"Sample rate {sr} Hz is too low for bandwidth analysis."
        return out
    n_fft = 2048 if sr >= 32000 else 1024
    hop = int(0.02 * sr)
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    nfr = dsp.n_frames(len(ctx.x), hop)
    t_frames = np.arange(nfr) * hop / sr
    vad_idx = np.clip(np.round(t_frames / FRAME_S).astype(int), 0, ctx.frames.n - 1)
    # All non-silent frames (speech and background): a channel or codec low-pass removes the
    # background noise above its cutoff too, whereas the natural upper edge of speech does not.
    speech = ctx.frames.energy_db[vad_idx] > -100.0

    win, step = 50, 25  # 1 s windows, 0.5 s hop (in 20 ms frames)
    n_w = max(0, (nfr - win) // step + 1)
    acc = np.zeros((nfr, freqs.size), dtype=np.float32) if nfr * freqs.size < 60_000_000 else None
    sums = np.zeros((n_w, freqs.size), dtype=np.float64)
    counts = np.zeros(n_w, dtype=np.int64)
    glob = np.zeros(freqs.size, dtype=np.float64)
    gcount = 0
    for i0, pw in dsp.power_spectrogram(ctx.x, n_fft, hop, n_fft, block=2048):
        sp = speech[i0 : i0 + len(pw)]
        if acc is not None:
            acc[i0 : i0 + len(pw)] = pw
        glob += pw[sp].sum(axis=0)
        gcount += int(sp.sum())
        for j in range(len(pw)):
            if not sp[j]:
                continue
            f = i0 + j
            w_hi = min(n_w - 1, f // step)
            w_lo = max(0, (f - win) // step + 1)
            if w_lo <= w_hi:
                sums[w_lo : w_hi + 1] += pw[j]
                counts[w_lo : w_hi + 1] += 1
    ctx.cache["native_spec_freqs"] = freqs
    if gcount < 25:
        out.status = "not_applicable"
        out.status_detail = "Not enough speech to estimate the recording bandwidth."
        return out
    g_cut, g_depth = find_cutoff(dsp.db(glob / gcount), freqs, p["cliff_db"])
    out.summary.update(
        effective_bandwidth_hz=g_cut,
        nyquist_hz=float(freqs[-1]),
        cliff_depth_db=g_depth,
        band_limited=g_cut < freqs[-1] - 1,
    )
    ctx.cache["effective_bandwidth_hz"] = g_cut

    cut = np.full(n_w, np.nan)
    for w in range(n_w):
        if counts[w] >= 25:
            cut[w], _ = find_cutoff(dsp.db(sums[w] / counts[w]), freqs, p["cliff_db"])
    out.summary["window_cutoffs_hz"] = {
        "min": float(np.nanmin(cut)) if np.isfinite(cut).any() else None,
        "max": float(np.nanmax(cut)) if np.isfinite(cut).any() else None,
    }
    factor = ADAPTIVE_CODECS.get(ctx.codec, 1.0)
    shifts = np.zeros(n_w)
    sides: dict[int, tuple[float, float]] = {}
    contrasts: dict[int, float] = {}
    for w in range(2, n_w - 2):
        left = cut[max(0, w - 3) : w]
        right = cut[w : w + 3]
        left, right = left[np.isfinite(left)], right[np.isfinite(right)]
        if left.size < 2 or right.size < 2:
            continue
        lm, rm = float(np.median(left)), float(np.median(right))
        if np.mean(np.abs(left - lm) < 300) < 0.66 or np.mean(np.abs(right - rm) < 300) < 0.66:
            continue
        s = abs(rm - lm)
        if s < max(p["min_shift_hz"], 0.1 * min(lm, rm)):
            continue
        # Confirm on the pooled spectra: the wider-band side must carry clearly more energy
        # just above the narrower cutoff (relative to the band below it) than the other side.
        lo_cut = min(lm, rm)
        L = sums[max(0, w - 3) : w].sum(axis=0) / max(1, counts[max(0, w - 3) : w].sum())
        R = sums[w : w + 3].sum(axis=0) / max(1, counts[w : w + 3].sum())
        up = (lo_cut + 150.0, min(max(lm, rm), lo_cut + 1500.0) - 150.0)
        ref = (max(300.0, lo_cut - 1500.0), lo_cut - 200.0)
        vals = [_band_db(X, freqs, *up) for X in (L, R)] + [_band_db(X, freqs, *ref) for X in (L, R)]
        if any(v is None for v in vals):
            continue
        rel_l, rel_r = vals[0] - vals[2], vals[1] - vals[3]
        contrast = (rel_r - rel_l) if rm > lm else (rel_l - rel_r)
        if contrast >= 30.0:
            shifts[w] = s
            sides[w] = (lm, rm)
            contrasts[w] = contrast
    peaks = dsp.local_peaks(shifts, min_distance=3, threshold=p["min_shift_hz"])
    for w in peaks:
        lm, rm = sides[int(w)]
        t_guess = (w * step) * hop / sr
        t_split = _refine_split(ctx, acc, freqs, hop, min(lm, rm), max(lm, rm), t_guess, speech)
        lo_hz, hi_hz = sorted((lm, rm))
        full_band = hi_hz >= freqs[-1] - 1
        strength = 0.85 * factor
        caveat = (
            f" The {ctx.codec} codec can switch bandwidth on its own, so this evidence is weighted down."
            if factor < 1
            else ""
        )
        out.candidates.append(
            Candidate(
                detector=ID,
                family="spectral",
                start=ctx.abs_time(max(0.0, t_split - 0.05)),
                end=ctx.abs_time(t_split + 0.05),
                strength=strength,
                measurements={
                    "cutoff_before_hz": lm,
                    "cutoff_after_hz": rm,
                    "shift_hz": abs(rm - lm),
                    "band_contrast_db": contrasts[int(w)],
                    "codec": ctx.codec,
                    "codec_adaptive_factor": factor,
                },
                explanation=(
                    f"The audio bandwidth changes from "
                    f"{'full band' if lm >= freqs[-1] - 1 else f'{lm / 1000:.1f} kHz'} to "
                    f"{'full band' if rm >= freqs[-1] - 1 else f'{rm / 1000:.1f} kHz'}. A change in "
                    f"the frequency cutoff suggests the material on each side passed through a "
                    f"different recording or encoding chain{' (one side is full band)' if full_band else ''}." + caveat
                ),
                alternatives=[
                    "Bandwidth switching by an adaptive codec (Opus, low-bit-rate AAC).",
                    "A call or stream whose network quality changed mid-recording.",
                ],
            )
        )
    return out


def _refine_split(ctx, acc, freqs, hop, lo_hz, hi_hz, t_guess, speech) -> float:
    """Locate the cutoff change at frame resolution by binary segmentation."""
    if acc is None:
        return t_guess
    sr = ctx.sr
    band_hi = (freqs > lo_hz + 150) & (freqs < min(hi_hz, freqs[-1]) - 150)
    band_ref = (freqs > max(300.0, lo_hz - 1200)) & (freqs < lo_hz - 200)
    if band_hi.sum() < 2 or band_ref.sum() < 2:
        return t_guess
    f0 = max(0, int((t_guess - 1.5) * sr / hop))
    f1 = min(acc.shape[0], int((t_guess + 1.5) * sr / hop))
    idx = np.arange(f0, f1)
    idx = idx[speech[f0:f1]]
    if idx.size < 10:
        return t_guess
    r = dsp.db(acc[idx][:, band_hi].mean(axis=1)) - dsp.db(acc[idx][:, band_ref].mean(axis=1))
    best, best_k = -1.0, None
    for k in range(3, len(r) - 3):
        d = abs(r[:k].mean() - r[k:].mean())
        if d > best:
            best, best_k = d, k
    if best_k is None:
        return t_guess
    return float(0.5 * (idx[best_k - 1] + idx[best_k]) * hop / sr)
