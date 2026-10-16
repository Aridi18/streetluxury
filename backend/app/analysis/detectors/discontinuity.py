"""Waveform discontinuities (clicks) and DC-offset steps.

A cut that is not placed at a zero crossing, or not crossfaded, leaves a step in
the waveform. A step has energy at all frequencies, so it appears as a very short
(< 3 ms), isolated burst in the high-pass filtered signal, far above the local
high-frequency level. Natural mouth clicks look similar, so this evidence alone
is capped at a low strength, and it is down-weighted further in recordings that
contain many clicks.
"""

from __future__ import annotations

import numpy as np
from scipy import signal as sps

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext

ID = "discontinuity"
VERSION = "1.0"


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Waveform discontinuities",
        family="waveform",
        version=VERSION,
        method=(
            "High-pass filters the native-rate waveform, finds isolated sub-3 ms bursts far above "
            "the local high-frequency level (median over ±25 ms), and measures the waveform step."
        ),
    )
    x, sr = ctx.x, ctx.sr
    bw = float(ctx.cache.get("effective_bandwidth_hz") or sr / 2)
    fc = min(4000.0, 0.25 * sr, 0.5 * bw)
    if fc < 1500:
        out.status = "not_applicable"
        out.status_detail = "Bandwidth too low to separate clicks from speech."
        return out
    sos = sps.butter(4, fc, btype="highpass", fs=sr, output="sos")
    hp = np.abs(sps.sosfiltfilt(sos, x)).astype(np.float32)
    blk = max(1, sr // 1000)  # 1 ms blocks
    nb = len(hp) // blk
    if nb < 200:
        out.status = "not_applicable"
        out.status_detail = "Recording too short."
        return out
    bmax = hp[: nb * blk].reshape(nb, blk).max(axis=1)
    ref = dsp.running_median(bmax, 51) + 1e-7
    ratio_db = 20 * np.log10(bmax / ref + 1e-12)
    clipped = np.abs(x[: nb * blk]).reshape(nb, blk).max(axis=1) >= 0.995
    hits = np.flatnonzero((ratio_db >= p["min_ratio_db"]) & (bmax > 10 ** (-60 / 20)) & ~clipped)
    cands: list[tuple[int, float, float]] = []
    for b in hits:
        # Isolation: the burst must not extend beyond 3 ms (plosives and fricatives do).
        lo, hi = max(0, b - 6), min(nb, b + 7)
        above = bmax[lo:hi] > 0.33 * bmax[b]
        if above.sum() > 3:
            continue
        if cands and b - cands[-1][0] < 20:
            if ratio_db[b] > cands[-1][1]:
                cands[-1] = (b, float(ratio_db[b]), 0.0)
            continue
        cands.append((b, float(ratio_db[b]), 0.0))
    duration_min = len(x) / sr / 60.0
    rate = len(cands) / max(duration_min, 1e-3)
    out.summary.update(isolated_clicks=len(cands), clicks_per_minute=rate, highpass_hz=fc)
    rate_penalty = 1.0 / (1.0 + max(0.0, rate - 2.0) / 4.0)
    for b, rdb, _ in cands:
        i = b * blk + int(np.argmax(hp[b * blk : (b + 1) * blk]))
        w = max(4, sr // 2000)  # 0.5 ms
        pre, post = x[max(0, i - w) : i], x[i + 1 : i + 1 + w]
        local = x[max(0, i - sr // 100) : i + sr // 100]
        rms = float(np.sqrt(np.mean(local.astype(np.float64) ** 2)) + 1e-9)
        step = float(abs(np.mean(post) - np.mean(pre))) / rms if pre.size and post.size else 0.0
        s = min(p["max_strength"], logistic(rdb, p["midpoint_db"], p["scale_db"])) * rate_penalty
        t = i / sr
        out.candidates.append(
            Candidate(
                detector=ID,
                family="waveform",
                start=ctx.abs_time(max(0.0, t - 0.005)),
                end=ctx.abs_time(t + 0.005),
                strength=s,
                measurements={
                    "burst_to_local_db": rdb,
                    "waveform_step_rel_rms": step,
                    "clicks_per_minute": rate,
                },
                explanation=(
                    f"An isolated click: a burst {rdb:.0f} dB above the surrounding high-frequency "
                    f"level lasting under 3 ms. Unfaded cuts leave this kind of waveform step."
                ),
                alternatives=[
                    "Mouth or lip noise, or the speaker touching the microphone.",
                    "Electrical interference or a packet-loss glitch in a call.",
                ],
            )
        )

    _dc_steps(ctx, out)
    return out


def _dc_steps(ctx: AnalysisContext, out: DetectorOutput) -> None:
    """DC-offset steps between sections recorded through different chains."""
    p = edit_params("level_dc")
    x, sr = ctx.x, ctx.sr
    blk = sr // 10  # 100 ms
    nb = len(x) // blk
    if nb < 20:
        return
    blocks = x[: nb * blk].reshape(nb, blk).astype(np.float64)
    dc = blocks.mean(axis=1)
    rms = np.sqrt((blocks**2).mean(axis=1))
    if np.max(np.abs(dc)) < 2e-4:
        out.summary["dc_offset"] = "negligible"
        return
    out.summary["dc_offset_range"] = [float(dc.min()), float(dc.max())]
    k = 5
    left = np.array([np.median(dc[max(0, i - k) : i]) if i > 0 else np.nan for i in range(nb)])
    right = np.array([np.median(dc[i : i + k]) for i in range(nb)])
    step = np.abs(right - left)
    mad = np.median(np.abs(np.diff(dc))) * 1.4826 + 1e-6
    z = step / mad
    peaks = dsp.local_peaks(np.nan_to_num(z, nan=-np.inf), min_distance=10, threshold=p["dc_midpoint"])
    for b in peaks:
        if step[b] < max(5e-4, 0.02 * np.median(rms)):
            continue
        t = b * blk / sr
        out.candidates.append(
            Candidate(
                detector=ID,
                family="waveform",
                start=ctx.abs_time(max(0.0, t - 0.1)),
                end=ctx.abs_time(t + 0.1),
                strength=logistic(float(z[b]), p["dc_midpoint"] * 1.5, p["dc_scale"]),
                measurements={"dc_before": float(left[b]), "dc_after": float(right[b]), "step_z": float(z[b])},
                explanation=(
                    f"The waveform's DC offset jumps from {left[b]:+.4f} to {right[b]:+.4f}. Material "
                    "recorded through one device chain normally keeps a stable DC offset."
                ),
                alternatives=["A device or analogue gain change during recording."],
            )
        )
