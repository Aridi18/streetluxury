"""Direct comparison of an alleged original with a suspected edited version.

Both recordings are fingerprinted; the suspect is aligned against the original
by hash voting on time offsets, which handles cuts, insertions and re-ordering
(unlike a single global alignment). Each matched segment is refined with
waveform cross-correlation. Everything reported here is *observed* by comparing
the two files; it says what differs, not which file came first.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from . import dsp
from . import fingerprint as fp
from .base import PIPELINE_VERSION, jsonable
from .features import FRAME_S, compute_frames, voice_activity

FS = fp.HOP / fp.SR  # 10 ms per fingerprint frame
MIN_MATCH_S = 0.3
MIN_GAP_S = 0.25


def _select_non_overlapping(matches: list[fp.Match]) -> list[fp.Match]:
    """Greedy selection by quality-weighted length, trimming overlaps in the suspect."""
    ranked = sorted(matches, key=lambda m: -(m.q_end - m.q_start) * (1 - m.ber))
    chosen: list[fp.Match] = []
    for m in ranked:
        a, b = m.q_start, m.q_end
        for c in chosen:
            if a < c.q_end and b > c.q_start:
                if a >= c.q_start and b <= c.q_end:
                    a = b  # fully covered
                    break
                if a < c.q_start:
                    b = min(b, c.q_start)
                else:
                    a = max(a, c.q_end)
        if b - a >= int(MIN_MATCH_S / FS):
            chosen.append(fp.Match(q_start=a, q_end=b, offset=m.offset, ber=m.ber, hits=m.hits))
    return sorted(chosen, key=lambda m: m.q_start)


def _refine(xa: np.ndarray, xb: np.ndarray, m: fp.Match) -> dict[str, Any]:
    """Sub-frame offset, similarity, polarity and level/spectral difference of a match."""
    b0, b1 = m.q_start * fp.HOP, m.q_end * fp.HOP
    a0 = (m.q_start + m.offset) * fp.HOP
    seg_b = xb[b0:b1].astype(np.float64)
    best, best_lag = 0.0, 0
    for lag in range(-fp.HOP, fp.HOP + 1, 4):
        s = a0 + lag
        if s < 0 or s + len(seg_b) > len(xa):
            continue
        seg_a = xa[s : s + len(seg_b)].astype(np.float64)
        c = float(np.dot(seg_a, seg_b) / ((np.linalg.norm(seg_a) * np.linalg.norm(seg_b)) + 1e-12))
        if abs(c) > abs(best):
            best, best_lag = c, lag
    for lag in range(best_lag - 4, best_lag + 5):
        s = a0 + lag
        if s < 0 or s + len(seg_b) > len(xa):
            continue
        seg_a = xa[s : s + len(seg_b)].astype(np.float64)
        c = float(np.dot(seg_a, seg_b) / ((np.linalg.norm(seg_a) * np.linalg.norm(seg_b)) + 1e-12))
        if abs(c) > abs(best):
            best, best_lag = c, lag
    s = max(0, a0 + best_lag)
    seg_a = xa[s : s + len(seg_b)].astype(np.float64)
    n = min(len(seg_a), len(seg_b))
    seg_a, seg_b = seg_a[:n], seg_b[:n]
    rms_a = np.sqrt(np.mean(seg_a**2) + 1e-20)
    rms_b = np.sqrt(np.mean(seg_b**2) + 1e-20)
    spec_diff = None
    if n >= 1024:
        pa = np.mean([p.mean(axis=0) for _, p in dsp.power_spectrogram(seg_a.astype(np.float32), 512, 256)], axis=0)
        pb = np.mean([p.mean(axis=0) for _, p in dsp.power_spectrogram(seg_b.astype(np.float32), 512, 256)], axis=0)
        da, dbb = dsp.db(pa), dsp.db(pb)
        d = (dbb - dbb.mean()) - (da - da.mean())
        spec_diff = float(np.sqrt(np.mean(d[5:200] ** 2)))
    drift = None
    if n > 8 * fp.SR:
        drift = _drift(seg_a, seg_b)
    return {
        "a_start": s / fp.SR,
        "a_end": (s + n) / fp.SR,
        "similarity": abs(best),
        "polarity_inverted": best < 0,
        "level_difference_db": float(20 * np.log10(rms_b / rms_a)),
        "spectral_shape_difference_db": spec_diff,
        "speed_ratio": drift,
    }


def _drift(a: np.ndarray, b: np.ndarray) -> float | None:
    """Estimate relative speed from the lag at the start vs. the end of a long match."""
    w = fp.SR
    lags = []
    for pos in (0, len(b) - w):
        sb = b[pos : pos + w]
        best, bl = -1.0, 0
        for lag in range(-200, 201, 2):
            s = pos + lag
            if s < 0 or s + w > len(a):
                continue
            sa = a[s : s + w]
            c = float(np.dot(sa, sb) / (np.linalg.norm(sa) * np.linalg.norm(sb) + 1e-12))
            if c > best:
                best, bl = c, lag
        lags.append(bl)
    span = len(b) - w
    ratio = 1.0 + (lags[1] - lags[0]) / span if span > 0 else 1.0
    return float(ratio)


def _speech_fraction(speech_mask: np.ndarray, t0: float, t1: float) -> float:
    i0, i1 = int(t0 / FRAME_S), max(int(t0 / FRAME_S) + 1, int(t1 / FRAME_S))
    seg = speech_mask[i0:i1]
    return float(seg.mean()) if seg.size else 0.0


def compare(xa: np.ndarray, xb: np.ndarray, progress=None) -> dict[str, Any]:
    """xa = alleged original, xb = suspect; both 16 kHz mono float32."""

    def prog(stage, f):
        if progress:
            progress(stage, f)

    prog("Fingerprinting", 0.1)
    fa, fb = fp.compute(xa), fp.compute(xb)
    vad_a = voice_activity(compute_frames(xa)).speech
    vad_b = voice_activity(compute_frames(xb)).speech
    dur_a, dur_b = len(xa) / fp.SR, len(xb) / fp.SR
    prog("Aligning", 0.35)
    votes = fp.offset_votes(fb, fa, same_signal=False, max_group=60)
    matches = fp.matched_regions(fb, fa, votes, max_ber=0.32, min_len=int(MIN_MATCH_S / FS), min_hits=3)
    matches = _select_non_overlapping(matches)
    prog("Refining matches", 0.6)

    segs: list[dict[str, Any]] = []
    for m in matches:
        r = _refine(xa, xb, m)
        if r["similarity"] < 0.3 and m.ber > 0.25:
            continue
        segs.append(
            {
                "type": "matched",
                "b_start": m.q_start * FS,
                "b_end": m.q_end * FS,
                **r,
                "fingerprint_bit_error_rate": m.ber,
            }
        )
    segs.sort(key=lambda s: s["b_start"])

    # Timeline of the suspect: matched segments and gaps.
    timeline: list[dict[str, Any]] = []
    cursor = 0.0
    for s in segs:
        if s["b_start"] - cursor >= MIN_GAP_S:
            timeline.append(_gap(cursor, s["b_start"], vad_b))
        timeline.append(s)
        cursor = max(cursor, s["b_end"])
    if dur_b - cursor >= MIN_GAP_S:
        timeline.append(_gap(cursor, dur_b, vad_b))

    # Original coverage: what was not found in the suspect.
    covered = np.zeros(int(dur_a / FS) + 1, dtype=bool)
    for s in segs:
        covered[int(s["a_start"] / FS) : int(s["a_end"] / FS)] = True
    removed = []
    for i0, i1 in dsp.bool_runs(~covered):
        t0, t1 = i0 * FS, min(dur_a, i1 * FS)
        if t1 - t0 < MIN_GAP_S:
            continue
        sp = _speech_fraction(vad_a, t0, t1)
        removed.append(
            {
                "a_start": t0,
                "a_end": t1,
                "duration_s": t1 - t0,
                "speech_fraction": sp,
                "kind": "speech" if sp >= 0.2 else "pause_or_silence",
            }
        )

    # Splice points in the suspect: discontinuities in the mapping between neighbours.
    splices = []
    reordered = 0
    for prev, nxt in zip(segs, segs[1:], strict=False):
        gap_b = nxt["b_start"] - prev["b_end"]
        jump_a = nxt["a_start"] - prev["a_end"]
        if nxt["a_start"] < prev["a_start"]:
            reordered += 1
            kind = "reordered"
        elif gap_b >= MIN_GAP_S and jump_a >= MIN_GAP_S:
            kind = "replaced"
        elif gap_b >= MIN_GAP_S:
            kind = "inserted"
        elif jump_a >= MIN_GAP_S:
            kind = "removed"
        elif abs(jump_a - gap_b) > 0.05:
            kind = "timing_shift"
        else:
            continue
        splices.append(
            {
                "b_time": prev["b_end"],
                "b_resume": nxt["b_start"],
                "a_from": prev["a_end"],
                "a_to": nxt["a_start"],
                "kind": kind,
                "a_jump_s": jump_a,
                "b_gap_s": gap_b,
            }
        )
    for t in timeline:
        if t["type"] == "unmatched":
            # A gap in the suspect where the original also has unmatched material is a replacement.
            t["type"] = "added"
    for sp in splices:
        if sp["kind"] == "replaced":
            for t in timeline:
                if t["type"] == "added" and abs(t["b_start"] - sp["b_time"]) < 0.05:
                    t["type"] = "changed"
                    t["a_start"], t["a_end"] = sp["a_from"], sp["a_to"]

    matched_b = sum(s["b_end"] - s["b_start"] for s in segs)
    matched_a = float(covered.sum() * FS)
    sims = [s["similarity"] for s in segs]
    levels = [s["level_difference_db"] for s in segs]
    speeds = [s["speed_ratio"] for s in segs if s["speed_ratio"] is not None]
    added = [t for t in timeline if t["type"] == "added" and t["speech_fraction"] >= 0.2]
    changed = [t for t in timeline if t["type"] == "changed"]
    removed_speech = [r for r in removed if r["kind"] == "speech"]
    shares_content = matched_b >= 0.2 * dur_b and matched_b >= 1.0
    notes = []
    if not shares_content:
        notes.append(
            "The two recordings share little or no audio content; they do not appear to be versions of "
            "the same recording, so detailed differences are not meaningful."
        )
    if levels and np.ptp(levels) > 3:
        notes.append(
            "The level difference between the files varies between segments, which indicates "
            "segment-specific gain changes."
        )
    if speeds and any(abs(s - 1) > 0.002 for s in speeds):
        notes.append(
            "At least one matched segment plays at a different speed in the suspect (time-stretch or resampling)."
        )
    if any(s["polarity_inverted"] for s in segs):
        notes.append("Some matched segments have inverted polarity.")
    notes.append(
        "These differences are observed by direct comparison of the two files. The comparison does not "
        "show which file is the original; it shows where they differ."
    )
    prog("Done", 1.0)
    return jsonable(
        {
            "pipeline_version": PIPELINE_VERSION,
            "method": (
                "32-bit audio fingerprints at 10 ms resolution aligned by offset voting (robust to cuts, "
                "insertions and re-ordering), verified by bit error rate, refined by waveform "
                "cross-correlation."
            ),
            "summary": {
                "original_duration_s": dur_a,
                "suspect_duration_s": dur_b,
                "duration_difference_s": dur_b - dur_a,
                "matched_suspect_s": matched_b,
                "matched_original_s": matched_a,
                "matched_fraction_suspect": matched_b / dur_b if dur_b else 0,
                "matched_fraction_original": matched_a / dur_a if dur_a else 0,
                "matched_segments": len(segs),
                "added_segments": len(added),
                "changed_segments": len(changed),
                "removed_segments": len(removed_speech),
                "reordered_boundaries": reordered,
                "splice_points": len(splices),
                "mean_similarity": float(np.mean(sims)) if sims else None,
                "median_level_difference_db": float(np.median(levels)) if levels else None,
                "shares_content": shares_content,
            },
            "timeline": timeline,
            "removed": removed,
            "splice_points": splices,
            "notes": notes,
        }
    )


def _gap(t0: float, t1: float, vad: np.ndarray) -> dict[str, Any]:
    sp = _speech_fraction(vad, t0, t1)
    return {
        "type": "unmatched",
        "b_start": t0,
        "b_end": t1,
        "duration_s": t1 - t0,
        "speech_fraction": sp,
        "content": "speech" if sp >= 0.2 else "pause_or_silence",
    }
