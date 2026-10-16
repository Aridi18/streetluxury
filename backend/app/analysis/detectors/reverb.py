"""Room acoustics: truncated decays and decay-rate changes.

When speech ends naturally, the room keeps ringing: the energy decays over tens
to hundreds of milliseconds. A cut placed right after a word removes that tail,
so the level falls from speech to the noise floor within a few milliseconds.
We measure every speech offset's sharpest 4 ms drop and compare it with the
recording's own offsets (dry close-mic recordings are sharper everywhere, so the
reference is internal). We also estimate the typical decay slope over 6 s
windows and report sustained changes, which suggest different rooms.
"""

from __future__ import annotations

import numpy as np

from .. import dsp
from ..base import Candidate, DetectorOutput, logistic
from ..calibration import edit_params
from ..context import AnalysisContext
from ..features import FRAME_S, SR16

ID = "reverb"
VERSION = "1.0"


def run(ctx: AnalysisContext) -> DetectorOutput:
    p = edit_params(ID)
    out = DetectorOutput(
        id=ID,
        name="Room acoustics continuity",
        family="acoustics",
        version=VERSION,
        method=(
            "At each speech offset, measures the sharpest 4 ms level drop and the decay slope "
            "to the noise floor; reports offsets far sharper than this recording's norm and "
            "sustained changes in decay rate."
        ),
    )
    x = ctx.x16
    blk = int(0.004 * SR16)
    offsets = [b for (_a, b) in ctx.vad.segments]
    floor = ctx.vad.floor_db
    rows = []
    for t_end in offsets:
        s_end = int(t_end * SR16)
        a, b = s_end - int(0.12 * SR16), s_end + int(0.2 * SR16)
        if a < 0 or b > len(x):
            continue
        seg = x[a:b].astype(np.float64)
        nb = len(seg) // blk
        env = 10 * np.log10(np.mean(seg[: nb * blk].reshape(nb, blk) ** 2, axis=1) + 1e-12)
        fl = float(floor[min(len(floor) - 1, int(t_end / FRAME_S))])
        peak_i = int(np.argmax(env[: int(0.12 / 0.004)]))
        peak = env[peak_i]
        total = peak - fl
        if total < 15:
            continue
        drops = env[peak_i:-1] - env[peak_i + 1 :]
        if drops.size == 0:
            continue
        j = int(np.argmax(drops))
        sharp = float(drops[j])
        # Decay slope (dB/s) from peak-5 dB down to floor+5 dB.
        tail = env[peak_i:]
        sel = np.flatnonzero((tail <= peak - 5) & (tail >= fl + 5))
        slope = None
        if sel.size >= 3:
            tt = sel * 0.004
            slope = float(np.polyfit(tt, tail[sel], 1)[0])
        rows.append(
            {
                "t": a / SR16 + (peak_i + j + 1) * 0.004,
                "sharpest_drop_db": sharp,
                "drop_fraction": sharp / total,
                "total_drop_db": float(total),
                "slope_db_s": slope,
            }
        )
    out.summary["offsets_measured"] = len(rows)
    if len(rows) < 6:
        out.status = "not_applicable"
        out.status_detail = "Too few clean speech offsets to characterise the room acoustics."
        return out
    sharp = np.array([r["sharpest_drop_db"] for r in rows])
    z = dsp.robust_z(sharp)
    out.summary["median_sharpest_drop_db"] = float(np.median(sharp))
    for r, zi in zip(rows, z, strict=True):
        if r["sharpest_drop_db"] < p["abrupt_min_db"] or r["drop_fraction"] < 0.6 or zi < 3.0:
            continue
        s = min(p["abrupt_max_strength"], logistic(float(zi), p["abrupt_midpoint_z"], p["abrupt_scale_z"]))
        out.candidates.append(
            Candidate(
                detector=ID,
                family="acoustics",
                start=ctx.abs_time(max(0.0, r["t"] - 0.02)),
                end=ctx.abs_time(r["t"] + 0.02),
                strength=s,
                measurements={
                    "sharpest_4ms_drop_db": r["sharpest_drop_db"],
                    "share_of_total_drop": r["drop_fraction"],
                    "recording_median_drop_db": float(np.median(sharp)),
                    "robust_z": float(zi),
                },
                explanation=(
                    f"Speech stops abruptly: the level falls {r['sharpest_drop_db']:.0f} dB within "
                    f"4 ms ({r['drop_fraction'] * 100:.0f}% of the drop to the noise floor), much "
                    f"sharper than the other word endings here (median {np.median(sharp):.0f} dB). "
                    "The natural room decay appears to be missing, as happens when audio is cut "
                    "right after a word."
                ),
                alternatives=["A stop consonant in a very dry, close-microphone recording.", "A noise gate closing."],
            )
        )

    # Decay-rate change between 6 s windows.
    times = np.array([r["t"] for r in rows])
    slopes = np.array([r["slope_db_s"] if r["slope_db_s"] is not None else np.nan for r in rows])
    good = np.isfinite(slopes) & (slopes < 0)
    if good.sum() >= 8:
        tg, sg = times[good], -slopes[good]
        out.summary["median_decay_db_per_s"] = float(np.median(sg))
        for k in range(3, len(tg) - 3):
            lft, rgt = sg[max(0, k - 5) : k], sg[k : k + 5]
            if (tg[k] - tg[max(0, k - 5)]) > 12 or (tg[min(len(tg) - 1, k + 4)] - tg[k]) > 12:
                continue
            ratio = float(np.median(lft) / np.median(rgt))
            ratio = max(ratio, 1 / ratio)
            if ratio < p["decay_ratio_min"]:
                continue
            out.candidates.append(
                Candidate(
                    detector=ID,
                    family="acoustics",
                    start=ctx.abs_time(tg[k - 1]),
                    end=ctx.abs_time(tg[k]),
                    strength=min(p["decay_max_strength"], 0.15 * ratio),
                    measurements={
                        "decay_before_db_s": float(np.median(lft)),
                        "decay_after_db_s": float(np.median(rgt)),
                        "ratio": ratio,
                    },
                    explanation=(
                        f"Word endings decay {ratio:.1f}× {'faster' if np.median(rgt) > np.median(lft) else 'slower'} "
                        "after this point than before it, which can indicate a different room or "
                        "microphone distance."
                    ),
                    alternatives=["The speaker turning away from or towards the microphone."],
                )
            )
    return out
