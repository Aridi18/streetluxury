"""Low-level DSP helpers (memory-bounded framing and spectra)."""

from __future__ import annotations

from collections.abc import Iterator

import numpy as np
import soxr
from numpy.lib.stride_tricks import sliding_window_view
from scipy import ndimage

EPS = 1e-12


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x.astype(np.float32, copy=False)
    return soxr.resample(x.astype(np.float32, copy=False), sr_in, sr_out, quality="HQ").astype(np.float32)


def n_frames(n_samples: int, hop: int) -> int:
    return 1 + n_samples // hop


def frame_blocks(x: np.ndarray, win: int, hop: int, block: int = 4096) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (first_frame, frames[block, win]) of a centred framing of ``x``."""
    pad = win // 2
    xp = np.pad(x, (pad, pad + hop), mode="constant")
    total = n_frames(len(x), hop)
    view = sliding_window_view(xp, win)[::hop]
    view = view[:total]
    for i in range(0, total, block):
        yield i, view[i : i + block]


def power_spectrogram(
    x: np.ndarray, n_fft: int, hop: int, win: int | None = None, block: int = 4096
) -> Iterator[tuple[int, np.ndarray]]:
    """Yield (first_frame, power[frames, n_fft//2+1]) in blocks (Hann window)."""
    win = win or n_fft
    w = np.hanning(win).astype(np.float32)
    norm = float(np.sum(w**2))
    for i, frames in frame_blocks(x, win, hop, block):
        spec = np.fft.rfft(frames * w, n=n_fft, axis=1)
        yield i, ((spec.real**2 + spec.imag**2) / norm).astype(np.float32)


def frame_rms_db(x: np.ndarray, win: int, hop: int) -> np.ndarray:
    out = np.empty(n_frames(len(x), hop), dtype=np.float32)
    for i, frames in frame_blocks(x, win, hop):
        ms = np.mean(frames.astype(np.float64) ** 2, axis=1)
        out[i : i + len(frames)] = 10 * np.log10(ms + EPS)
    return out


def db(p: np.ndarray | float, floor: float = -120.0) -> np.ndarray:
    return np.maximum(10 * np.log10(np.asarray(p) + EPS), floor)


def running_median(x: np.ndarray, size: int) -> np.ndarray:
    size = max(1, int(size) | 1)
    return ndimage.median_filter(x, size=size, mode="nearest")


def running_min(x: np.ndarray, size: int) -> np.ndarray:
    return ndimage.minimum_filter1d(x, size=max(1, int(size)), mode="nearest")


def running_max(x: np.ndarray, size: int) -> np.ndarray:
    return ndimage.maximum_filter1d(x, size=max(1, int(size)), mode="nearest")


def moving_average(x: np.ndarray, size: int) -> np.ndarray:
    return ndimage.uniform_filter1d(x.astype(np.float64), size=max(1, int(size)), mode="nearest")


def bool_runs(mask: np.ndarray) -> list[tuple[int, int]]:
    """Return [start, end) index pairs of True runs."""
    if mask.size == 0:
        return []
    m = np.concatenate([[False], mask.astype(bool), [False]])
    d = np.diff(m.astype(np.int8))
    starts = np.flatnonzero(d == 1)
    ends = np.flatnonzero(d == -1)
    return list(zip(starts.tolist(), ends.tolist(), strict=True))


def robust_z(x: np.ndarray, values: np.ndarray | None = None) -> np.ndarray:
    """Robust z-score of ``x`` against the median/MAD of ``values`` (default ``x``)."""
    ref = x if values is None else values
    ref = ref[np.isfinite(ref)]
    if ref.size == 0:
        return np.zeros_like(x)
    med = np.median(ref)
    mad = np.median(np.abs(ref - med)) * 1.4826
    return (x - med) / max(mad, 1e-9)


def local_peaks(x: np.ndarray, min_distance: int, threshold: float) -> np.ndarray:
    """Indices of local maxima >= threshold separated by at least ``min_distance``."""
    if x.size == 0:
        return np.array([], dtype=int)
    xm = np.where(np.isfinite(x), x, -np.inf)
    mx = ndimage.maximum_filter1d(xm, size=2 * min_distance + 1, mode="nearest")
    idx = np.flatnonzero((xm >= mx) & (xm >= threshold))
    if idx.size == 0:
        return idx
    # Collapse plateaus: keep the centre of consecutive equal maxima.
    keep: list[int] = []
    group = [idx[0]]
    for i in idx[1:]:
        if i - group[-1] <= min_distance:
            group.append(i)
        else:
            keep.append(group[len(group) // 2])
            group = [i]
    keep.append(group[len(group) // 2])
    return np.asarray(keep, dtype=int)


def window_sums(values: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Prefix sums enabling O(1) masked window means. values: (n, d) or (n,)."""
    v = np.where(mask[:, None] if values.ndim == 2 else mask, values, 0.0).astype(np.float64)
    cs = np.concatenate([np.zeros((1,) + v.shape[1:]), np.cumsum(v, axis=0)])
    cn = np.concatenate([[0], np.cumsum(mask.astype(np.int64))])
    return cs, cn
