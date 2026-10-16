"""Robust audio fingerprints (Haitsma–Kalker style) for copy and alignment search.

Each 10 ms frame gets a 32-bit sub-fingerprint from the signs of energy
differences across 33 log-spaced bands (300–4000 Hz) and adjacent frames. Two
copies of the same audio produce nearly identical bit sequences even after lossy
re-encoding; unrelated speech differs in ~50% of bits. Matching is done by hash
voting on time offsets followed by bit-error-rate verification.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

import numpy as np

from . import dsp

SR = 16000
HOP = 160
WIN = 1024
N_BANDS = 33


@dataclass
class Fingerprints:
    bits: np.ndarray  # (n,) uint32
    valid: np.ndarray  # (n,) bool: frame has enough energy to be meaningful
    energy_db: np.ndarray

    @property
    def n(self) -> int:
        return int(self.bits.size)


def _band_matrix(n_fft: int) -> np.ndarray:
    freqs = np.fft.rfftfreq(n_fft, 1.0 / SR)
    edges = np.geomspace(300.0, 4000.0, N_BANDS + 1)
    m = np.zeros((N_BANDS, freqs.size), dtype=np.float32)
    for b in range(N_BANDS):
        m[b, (freqs >= edges[b]) & (freqs < edges[b + 1])] = 1.0
    return m


_BANDS = _band_matrix(WIN)
_WEIGHTS = (1 << np.arange(32, dtype=np.uint64)).astype(np.uint64)


def compute(x16: np.ndarray) -> Fingerprints:
    n = dsp.n_frames(len(x16), HOP)
    e = np.empty((n, N_BANDS), dtype=np.float32)
    for i, p in dsp.power_spectrogram(x16, WIN, HOP, WIN):
        e[i : i + len(p)] = p @ _BANDS.T
    le = np.log(e + 1e-10)
    d = le[:, :-1] - le[:, 1:]
    dd = np.zeros_like(d)
    dd[1:] = d[1:] - d[:-1]
    bits = ((dd > 0).astype(np.uint64) * _WEIGHTS[None, :]).sum(axis=1).astype(np.uint32)
    energy_db = 10 * np.log10(e.sum(axis=1) + 1e-12)
    floor = np.percentile(energy_db, 20)
    valid = energy_db > floor + 10
    valid[0] = False
    return Fingerprints(bits=bits, valid=valid, energy_db=energy_db)


def popcount32(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.uint32)
    x = x - ((x >> 1) & 0x55555555)
    x = (x & 0x33333333) + ((x >> 2) & 0x33333333)
    x = (x + (x >> 4)) & 0x0F0F0F0F
    return ((x * 0x01010101) & 0xFFFFFFFF) >> 24


def bit_errors(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return popcount32(np.bitwise_xor(a, b)).astype(np.float32) / 32.0


def _keys(bits: np.ndarray) -> list[np.ndarray]:
    # Full 32-bit hash plus two 16-bit halves for robustness to bit errors.
    return [
        bits.astype(np.uint64),
        (bits & 0xFFFF).astype(np.uint64) | (1 << 40),
        (bits >> 16).astype(np.uint64) | (2 << 40),
    ]


def offset_votes(
    query: Fingerprints,
    ref: Fingerprints,
    *,
    same_signal: bool,
    min_lag: int = 50,
    max_group: int = 40,
) -> dict[int, list[int]]:
    """Return {offset: [query_frame, ...]} where ref[q + offset] matches query[q].

    For ``same_signal`` only positive offsets of at least ``min_lag`` frames are
    considered (a frame trivially matches itself).
    """
    votes: dict[int, list[int]] = defaultdict(list)
    qi = np.flatnonzero(query.valid)
    ri = np.flatnonzero(ref.valid)
    for kq, kr in zip(_keys(query.bits), _keys(ref.bits), strict=True):
        table: dict[int, list[int]] = defaultdict(list)
        for i, h in zip(ri.tolist(), kr[ri].tolist(), strict=True):
            table[h].append(i)
        for q, h in zip(qi.tolist(), kq[qi].tolist(), strict=True):
            hits = table.get(h)
            if not hits or len(hits) > max_group:
                continue
            for r in hits:
                off = r - q
                if same_signal and off < min_lag:
                    continue
                votes[off].append(q)
    return votes


@dataclass
class Match:
    q_start: int
    q_end: int  # exclusive
    offset: int  # ref frame = query frame + offset
    ber: float
    hits: int


def matched_regions(
    query: Fingerprints,
    ref: Fingerprints,
    votes: dict[int, list[int]],
    *,
    min_hits: int = 4,
    gap: int = 25,
    max_ber: float = 0.3,
    min_len: int = 30,
    smooth: int = 21,
) -> list[Match]:
    """Turn offset votes into verified, extended matching regions."""
    out: list[Match] = []
    for off, qs in votes.items():
        if len(qs) < min_hits:
            continue
        qs = np.unique(np.asarray(qs))
        groups = np.split(qs, np.flatnonzero(np.diff(qs) > gap) + 1)
        for g in groups:
            if g.size < min_hits:
                continue
            m = _extend(query, ref, int(g[0]), int(g[-1]) + 1, off, max_ber, smooth)
            if m is not None and (m.q_end - m.q_start) >= min_len:
                m.hits = int(g.size)
                out.append(m)
    return _dedupe(out)


def _extend(query, ref, q0, q1, off, max_ber, smooth) -> Match | None:
    lo = max(0, -off)
    hi = min(query.n, ref.n - off)
    if hi - lo < 10:
        return None
    qa = query.bits[lo:hi]
    ra = ref.bits[lo + off : hi + off]
    err = bit_errors(qa, ra)
    sm = dsp.moving_average(err, smooth)
    good = sm < max_ber
    c0, c1 = max(q0, lo) - lo, min(q1, hi) - lo - 1
    if c1 < c0 or not good[c0 : c1 + 1].mean() > 0.5:
        return None
    a = c0
    while a > 0 and good[a - 1]:
        a -= 1
    b = c1
    while b < len(good) - 1 and good[b + 1]:
        b += 1
    # Trim smoothing spill at both ends.
    half = smooth // 2
    a = min(a + half // 2, b)
    b = max(b - half // 2, a)
    seg_err = err[a : b + 1]
    valid = query.valid[lo + a : lo + b + 1]
    ber = float(seg_err[valid].mean()) if valid.any() else float(seg_err.mean())
    return Match(q_start=lo + a, q_end=lo + b + 1, offset=off, ber=ber, hits=0)


def _dedupe(ms: list[Match]) -> list[Match]:
    ms.sort(key=lambda m: (m.ber, -(m.q_end - m.q_start)))
    kept: list[Match] = []
    for m in ms:
        dup = False
        for k in kept:
            ov = min(m.q_end, k.q_end) - max(m.q_start, k.q_start)
            if ov > 0.5 * (m.q_end - m.q_start) and abs(m.offset - k.offset) < 15:
                dup = True
                break
        if not dup:
            kept.append(m)
    return sorted(kept, key=lambda m: m.q_start)
