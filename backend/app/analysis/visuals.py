"""Waveform peaks and spectrogram tiles for the analysis workspace.

The spectrogram is computed on the server at the native sample rate (so
bandwidth evidence is visible) and delivered as PNG tiles of 30 s each, which
the client positions on the zoomable timeline.
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from . import dsp

PEAKS_PER_SECOND = 100
MAX_PEAKS = 200_000
TILE_SECONDS = 30.0
COLUMNS_PER_SECOND = 60
ROWS = 256

# Perceptually ordered dark -> purple -> white colour map matching the UI.
_STOPS = np.array(
    [
        [0.00, 9, 9, 14],
        [0.25, 38, 18, 74],
        [0.50, 104, 46, 170],
        [0.72, 168, 112, 240],
        [0.88, 226, 200, 255],
        [1.00, 255, 255, 255],
    ],
    dtype=np.float64,
)
_LUT = np.stack([np.interp(np.linspace(0, 1, 256), _STOPS[:, 0], _STOPS[:, i]) for i in (1, 2, 3)], axis=1).astype(
    np.uint8
)


def peaks(x: np.ndarray, sr: int) -> dict:
    duration = len(x) / sr
    n = int(min(MAX_PEAKS, max(100, duration * PEAKS_PER_SECOND)))
    edges = np.linspace(0, len(x), n + 1).astype(np.int64)
    ax = np.abs(x)
    vals = np.maximum.reduceat(ax, edges[:-1]) if len(x) else np.zeros(n)
    vals = vals[:n]
    top = float(vals.max()) if vals.size else 1.0
    norm = vals / top if top > 0 else vals
    return {
        "duration": duration,
        "peaks": [round(float(v), 4) for v in norm],
        "scale": top,
        "per_second": n / duration if duration else 0,
    }


def _row_matrix(n_bins: int, rows: int) -> np.ndarray:
    """Average adjacent FFT bins into ``rows`` linear-frequency rows."""
    m = np.zeros((n_bins, rows), dtype=np.float32)
    edges = np.linspace(0, n_bins, rows + 1)
    for r in range(rows):
        a, b = int(np.floor(edges[r])), max(int(np.floor(edges[r])) + 1, int(np.floor(edges[r + 1])))
        m[a:b, r] = 1.0 / (b - a)
    return m


def spectrogram_tiles(x: np.ndarray, sr: int) -> list[dict]:
    """Return [{index, start, end, png}] tiles covering the signal (memory-bounded)."""
    duration = len(x) / sr
    hop = max(1, int(round(sr / COLUMNS_PER_SECOND)))
    n_fft = 2048 if sr >= 32000 else (1024 if sr >= 16000 else 512)
    red = _row_matrix(n_fft // 2 + 1, ROWS)
    cols: list[np.ndarray] = []
    for _, p in dsp.power_spectrogram(x, n_fft, hop, n_fft, block=2048):
        cols.append((10 * np.log10(p @ red + 1e-12)).astype(np.float32))
    sdb = np.concatenate(cols, axis=0) if cols else np.full((1, ROWS), -120.0, dtype=np.float32)
    top = float(np.percentile(sdb[:: max(1, sdb.shape[0] // 20000)], 99.9)) + 3.0
    lo = top - 85.0
    tiles = []
    cols_per_tile = int(TILE_SECONDS * sr / hop)
    for i, c0 in enumerate(range(0, sdb.shape[0], cols_per_tile)):
        part = np.clip((sdb[c0 : c0 + cols_per_tile] - lo) / (top - lo), 0.0, 1.0)
        part = (part.T[::-1] ** 1.35 * 255).astype(np.uint8)  # (ROWS, t), low frequencies at bottom
        buf = io.BytesIO()
        Image.fromarray(_LUT[part], "RGB").save(buf, format="PNG", optimize=True)
        start = c0 * hop / sr
        end = min(duration, (c0 + part.shape[1]) * hop / sr)
        tiles.append({"index": i, "start": start, "end": end, "png": buf.getvalue()})
    return tiles


def waveform_png(
    peak_values: list[float], width: int, height: int, regions: list[tuple[float, float, str]], duration: float
) -> bytes:
    """Static waveform image with highlighted regions (for PDF reports)."""
    bg = np.array([18, 18, 24], dtype=np.float64)
    arr = np.tile(bg, (height, width, 1))
    vals = np.asarray(peak_values, dtype=np.float64)
    colours = {"high": (220, 70, 90), "medium": (240, 170, 60), "low": (120, 120, 140), "synthetic": (170, 110, 255)}
    if vals.size and duration > 0:
        for start, end, sev in regions:
            x0 = int(max(0, start / duration * width))
            x1 = int(min(width - 1, max(x0 + 2, end / duration * width)))
            arr[:, x0 : x1 + 1] = 0.35 * np.array(colours.get(sev, (120, 120, 140))) + 0.65 * bg
        cols = np.interp(np.linspace(0, vals.size - 1, width), np.arange(vals.size), vals)
        mid = height // 2
        yy = np.arange(height)[:, None]
        h = (cols * (height / 2 - 2)).astype(int)[None, :]
        mask = np.abs(yy - mid) <= h
        arr[mask] = (196, 160, 255)
    buf = io.BytesIO()
    Image.fromarray(arr.astype(np.uint8), "RGB").save(buf, format="PNG")
    return buf.getvalue()
