"""Evaluate and calibrate the synthetic-speech detectors.

Data: the In-the-Wild deepfake dataset (Müller et al., Interspeech 2022), which
was *not* used to train either detector. Clips are split by speaker into a
calibration half and a test half, so no speaker appears in both.

Procedure per detector:
1. Score one window per clip (the central 4 s, or the whole clip if shorter;
   clips with < 1 s of audio are skipped) exactly as the deployed pipeline scores
   each 4 s window.
2. Calibration half: fit Platt scaling with balanced class weights (equal prior),
   then set the "possible" and "strong" thresholds so that 5% and 1% of genuine
   calibration windows exceed them (never below 0.5).
3. Test half: report EER, ROC AUC and TPR/FPR at both thresholds, by clip
   length, and under codec/channel degradations (MP3, AAC, Opus voice-note,
   8 kHz telephone band, additive noise) applied to a balanced subset.
4. Optional out-of-domain genuine speech (LibriSpeech) to measure false
   positives on read speech, and a partial-spoof localisation test.
5. Write ``backend/calibration/synthetic/<detector>.json``; a detector is
   allowed to influence verdicts only if its held-out EER <= 15% and AUC >= 0.90.

Usage::

    backend/.venv/bin/python evaluation/synthetic_eval.py --itw /data/itw \
        --librispeech /data/LibriSpeech/dev-clean --write-calibration
"""

from __future__ import annotations

import argparse
import glob
import io
import json
import time
from pathlib import Path

import numpy as np
import soundfile as sf

from common import (
    CALIBRATION,
    RESULTS,
    WORK,
    auc,
    degrade,
    eer,
    fit_platt,
    now,
    rates_at,
    sigmoid,
    split_of,
    update_summary,
    write_json,
)

SR = 16000
WIN = 4 * SR
MIN = SR
CONDITIONS = ["original", "mp3_64k", "aac_48k", "opus_16k", "narrowband_8k", "noise_snr10"]
VERDICT_MAX_EER = 0.15
VERDICT_MIN_AUC = 0.90


def load_itw(directory: Path, max_per_split: int | None):
    """Stream the parquet shards and decode only the clips that are needed."""
    import pyarrow.parquet as pq

    rows = []
    for shard in sorted(directory.glob("test-*.parquet")):
        meta = pq.read_table(shard, columns=["label", "notes"]).to_pylist()
        for i, r in enumerate(meta):
            notes = json.loads(r["notes"])
            rows.append((shard, i, notes["utterance_id"], int(r["label"]), notes["speaker"]))
    if max_per_split:
        rng = np.random.default_rng(1)
        keep = []
        for sp in ("calibration", "test"):
            part = [r for r in rows if split_of(r[4]) == sp]
            keep += [part[i] for i in sorted(rng.permutation(len(part))[:max_per_split])]
        rows = keep
    wanted: dict[Path, dict[int, tuple]] = {}
    for r in rows:
        wanted.setdefault(r[0], {})[r[1]] = r
    clips = []
    for shard, idx in wanted.items():
        pf = pq.ParquetFile(shard)
        offset = 0
        for batch in pf.iter_batches(batch_size=256, columns=["audio"]):
            audios = batch.column("audio").to_pylist()
            for j, a in enumerate(audios):
                r = idx.get(offset + j)
                if r is None:
                    continue
                audio, sr = sf.read(io.BytesIO(a["bytes"]), dtype="float32")
                if audio.ndim > 1:
                    audio = audio.mean(axis=1)
                assert sr == SR, sr
                clips.append({"id": r[2], "label": r[3], "speaker": r[4], "split": split_of(r[4]),
                              "duration": len(audio) / SR, "audio": audio})
            offset += len(audios)
    return clips


def window_of(x: np.ndarray) -> np.ndarray | None:
    if len(x) < MIN:
        return None
    if len(x) <= WIN:
        return x
    s = (len(x) - WIN) // 2
    return x[s : s + WIN]


def score_clips(det, clips, condition: str, cache_name: str) -> dict[str, float]:
    path = WORK / f"{cache_name}.json"
    cache: dict[str, float] = json.loads(path.read_text()) if path.exists() else {}
    todo = [c for c in clips if c["id"] not in cache]
    rng = np.random.default_rng(7)
    t0 = time.time()
    batch_ids, batch = [], []

    def flush():
        if not batch:
            return
        scores = det.raw_scores(batch, batch=8)
        for i, s in zip(batch_ids, scores, strict=True):
            cache[i] = float(s)
        batch_ids.clear()
        batch.clear()

    for k, c in enumerate(todo):
        w = window_of(c["audio"])
        if w is None:
            continue
        w = degrade(w, SR, condition, rng)
        batch_ids.append(c["id"])
        batch.append(w.astype(np.float32))
        if len(batch) >= 16:
            flush()
        if (k + 1) % 400 == 0:
            flush()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(cache))
            rate = (k + 1) / (time.time() - t0)
            print(f"    {cache_name}: {k + 1}/{len(todo)} ({rate:.1f} clips/s)", flush=True)
    flush()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache))
    return cache


def arrays(clips, scores):
    ids = [c for c in clips if c["id"] in scores]
    y = np.array([c["label"] for c in ids])
    s = np.array([scores[c["id"]] for c in ids])
    return ids, y, s


def summarise(y, s, cal_p, a, b, thr) -> dict:
    p = sigmoid(a * s + b)
    e, _ = eer(y, s)
    return {
        "n_bonafide": int((y == 0).sum()),
        "n_spoof": int((y == 1).sum()),
        "eer": e,
        "auc": auc(y, s),
        "at_possible": rates_at(y, p, thr["possible"]),
        "at_strong": rates_at(y, p, thr["strong"]),
        "brier": float(np.mean((p - y) ** 2)),
    }


def partial_spoof_test(det, clips, a, b, thr, n: int):
    """Insert a spoof clip between two genuine clips of the same speaker and test
    whether window-level scores localise the synthetic part."""
    from app.analysis.context import build_context
    from app.analysis.synthetic import make_windows

    rng = np.random.default_rng(11)
    by_spk: dict[str, dict[int, list]] = {}
    for c in clips:
        if c["split"] == "test" and c["duration"] >= 3.0:
            by_spk.setdefault(c["speaker"], {0: [], 1: []})[c["label"]].append(c)
    spks = [s for s, d in by_spk.items() if len(d[0]) >= 2 and len(d[1]) >= 1]
    detected = 0
    region_n = 0
    false_windows = 0
    clean_windows = 0
    errors = []
    for _ in range(n):
        spk = spks[rng.integers(len(spks))]
        g1, g2 = rng.choice(len(by_spk[spk][0]), 2, replace=False)
        f = rng.integers(len(by_spk[spk][1]))
        A, B, C = by_spk[spk][0][g1]["audio"], by_spk[spk][1][f]["audio"], by_spk[spk][0][g2]["audio"]
        x = np.concatenate([A, B, C]).astype(np.float32)
        s0, s1 = len(A) / SR, (len(A) + len(B)) / SR
        ctx = build_context(x, SR)
        wins = [w for w in make_windows(ctx) if w["scored"]]
        segs = [x[int(w["start"] * SR) : int(w["end"] * SR)] for w in wins]
        raw = det.raw_scores(segs)
        p = sigmoid(a * raw + b)
        flagged = p >= thr["possible"]
        region_n += 1
        hit = False
        for w, fl in zip(wins, flagged, strict=True):
            overlap = max(0.0, min(w["end"], s1) - max(w["start"], s0)) / (w["end"] - w["start"])
            if overlap >= 0.5 and fl:
                hit = True
            if overlap == 0:
                clean_windows += 1
                false_windows += int(fl)
        detected += int(hit)
        if hit:
            fl_w = [w for w, fl in zip(wins, flagged, strict=True) if fl]
            est0 = min(w["start"] for w in fl_w)
            est1 = max(w["end"] for w in fl_w)
            errors.append((abs(est0 - s0) + abs(est1 - s1)) / 2)
    return {
        "composites": region_n,
        "synthetic_region_detection_rate": detected / max(1, region_n),
        "false_flag_rate_genuine_windows": false_windows / max(1, clean_windows),
        "median_boundary_error_s": float(np.median(errors)) if errors else None,
        "note": "Each composite = genuine clip + spoof clip + genuine clip of the same speaker (In-the-Wild test "
        "speakers). Detected = a window overlapping the synthetic part by >= 50% is at or above the 'possible' "
        "threshold. Boundary error is the mean distance of the flagged span's edges from the true edges; "
        "4 s windows bound localisation precision to roughly +/-2 s.",
    }


def librispeech_bonafide(det, root: Path, n: int, a, b, thr):
    files = sorted(glob.glob(str(root / "*" / "*" / "*.flac")))
    rng = np.random.default_rng(3)
    files = [files[i] for i in rng.permutation(len(files))[:n]]
    wins = []
    for f in files:
        x, _ = sf.read(f, dtype="float32")
        w = window_of(x)
        if w is not None:
            wins.append(w)
    raw = det.raw_scores(wins)
    p = sigmoid(a * raw + b)
    return {
        "dataset": f"LibriSpeech {root.name} (read English audiobooks), {len(wins)} genuine windows",
        "fpr_possible": float(np.mean(p >= thr["possible"])),
        "fpr_strong": float(np.mean(p >= thr["strong"])),
        "median_probability": float(np.median(p)),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--itw", type=Path, required=True)
    ap.add_argument("--models", default="antideepfake-w2v2-small,aasist")
    ap.add_argument("--max-per-split", type=int, default=None)
    ap.add_argument("--condition-clips", type=int, default=600)
    ap.add_argument("--partial", type=int, default=150)
    ap.add_argument("--librispeech", type=Path, default=None)
    ap.add_argument("--write-calibration", action="store_true")
    args = ap.parse_args()

    from app.analysis.synthetic import configure_torch, registry

    configure_torch()
    print("Loading In-the-Wild clips…", flush=True)
    clips = load_itw(args.itw, args.max_per_split)
    cal = [c for c in clips if c["split"] == "calibration"]
    test = [c for c in clips if c["split"] == "test"]
    print(f"  {len(clips)} clips; calibration {len(cal)} ({len({c['speaker'] for c in cal})} speakers), "
          f"test {len(test)} ({len({c['speaker'] for c in test})} speakers)", flush=True)
    rng = np.random.default_rng(5)
    sub = []
    for lab in (0, 1):
        part = [c for c in test if c["label"] == lab]
        sub += [part[i] for i in rng.permutation(len(part))[: args.condition_clips // 2]]

    all_results = {}
    for model_id in args.models.split(","):
        det = registry()[model_id]
        state, detail = det.availability()
        if state != "ready":
            print(f"Skipping {model_id}: {detail}")
            continue
        print(f"== {model_id}", flush=True)
        scores = score_clips(det, clips, "original", f"{model_id}_original")
        _, yc, sc = arrays(cal, scores)
        a, b = fit_platt(sc, yc)
        pc = sigmoid(a * sc + b)
        bona = pc[yc == 0]
        thr = {
            "possible": float(max(0.5, np.quantile(bona, 0.95))),
            "strong": float(max(0.5, np.quantile(bona, 0.99))),
        }
        if thr["strong"] < thr["possible"]:
            thr["strong"] = thr["possible"]
        cal_metrics = summarise(yc, sc, pc, a, b, thr)
        _, yt, st = arrays(test, scores)
        test_metrics = summarise(yt, st, None, a, b, thr)
        # By clip length (original condition).
        by_len = []
        dur = {c["id"]: c["duration"] for c in clips}
        ids_t, _, _ = arrays(test, scores)
        for lo, hi, name in ((1, 2, "1-2 s"), (2, 4, "2-4 s"), (4, 8, "4-8 s"), (8, 1e9, ">8 s")):
            m = np.array([lo <= dur[c["id"]] < hi for c in ids_t])
            if m.sum() >= 20 and len(set(yt[m])) == 2:
                p = sigmoid(a * st[m] + b)
                by_len.append({"length": name, "n": int(m.sum()), "eer": eer(yt[m], st[m])[0],
                               "tpr_possible": rates_at(yt[m], p, thr["possible"])["tpr"],
                               "fpr_possible": rates_at(yt[m], p, thr["possible"])["fpr"]})
        by_cond = []
        for cond in CONDITIONS:
            cs = score_clips(det, sub, cond, f"{model_id}_{cond}_sub{args.condition_clips}")
            _, yy, ss = arrays(sub, cs)
            p = sigmoid(a * ss + b)
            r_pos = rates_at(yy, p, thr["possible"])
            r_str = rates_at(yy, p, thr["strong"])
            by_cond.append({"condition": cond, "n": int(len(yy)), "eer": eer(yy, ss)[0], "auc": auc(yy, ss),
                            "tpr_possible": r_pos["tpr"], "fpr_possible": r_pos["fpr"],
                            "tpr_strong": r_str["tpr"], "fpr_strong": r_str["fpr"]})
            print(f"    {cond:14s} EER {by_cond[-1]['eer']:.3f}  FPR@possible {r_pos['fpr']:.3f}  TPR@possible {r_pos['tpr']:.3f}", flush=True)
        test_metrics["by_length"] = by_len
        test_metrics["by_condition"] = by_cond
        ood = librispeech_bonafide(det, args.librispeech, 300, a, b, thr) if args.librispeech else None
        partial = partial_spoof_test(det, clips, a, b, thr, args.partial) if args.partial else None
        use = test_metrics["eer"] <= VERDICT_MAX_EER and test_metrics["auc"] >= VERDICT_MIN_AUC
        record = {
            "detector_id": model_id,
            "created_at": now(),
            "model_version": det.info.version,
            "platt": {"a": a, "b": b},
            "thresholds": thr,
            "use_for_verdict": bool(use),
            "verdict_rule": f"use_for_verdict requires held-out EER <= {VERDICT_MAX_EER:.0%} and AUC >= {VERDICT_MIN_AUC}",
            "provenance": {
                "dataset": "In-the-Wild (Müller et al. 2022; SpeechAntiSpoofingBenchmarks/InTheWild, Apache-2.0), "
                f"{len(clips)} clips from shards {', '.join(p.stem for p in sorted(args.itw.glob('test-*.parquet')))}",
                "split": "speaker-disjoint: calibration and test halves by SHA-256 of the speaker name",
                "procedure": "Platt scaling with balanced class weights on central 4 s windows of the calibration "
                "half; 'possible' and 'strong' thresholds at the 95th and 99th percentile of calibrated genuine "
                "calibration windows (minimum 0.5). Metrics on the test half only.",
                "note": "Calibrated probabilities assume equal prior odds of genuine and synthetic speech and are "
                "valid for conditions resembling In-the-Wild (English public-figure speech from online media).",
            },
            "metrics": {"calibration": cal_metrics, "test": test_metrics, "out_of_domain_bonafide": ood,
                        "partial_spoof_localisation": partial},
        }
        all_results[model_id] = record
        print(f"  test EER {test_metrics['eer']:.4f} AUC {test_metrics['auc']:.4f} "
              f"TPR/FPR@possible {test_metrics['at_possible']['tpr']:.3f}/{test_metrics['at_possible']['fpr']:.3f} "
              f"use_for_verdict={use}", flush=True)
        if ood:
            print(f"  LibriSpeech genuine FPR@possible {ood['fpr_possible']:.3f}", flush=True)
        if partial:
            print(f"  partial-spoof detection {partial['synthetic_region_detection_rate']:.3f}, "
                  f"false flags {partial['false_flag_rate_genuine_windows']:.3f}", flush=True)
        if args.write_calibration:
            write_json(CALIBRATION / "synthetic" / f"{model_id}.json", record)
        write_json(RESULTS / f"synthetic_{model_id}.json", record)

    summary_path = CALIBRATION / "evaluation_summary.json"
    try:
        section = json.loads(summary_path.read_text()).get("synthetic_detection", {})
    except FileNotFoundError:
        section = {}
    for k, v in all_results.items():
        section[k] = {
            "eer": v["metrics"]["test"]["eer"],
            "auc": v["metrics"]["test"]["auc"],
            "n_bonafide": v["metrics"]["test"]["n_bonafide"],
            "n_spoof": v["metrics"]["test"]["n_spoof"],
            "use_for_verdict": v["use_for_verdict"],
            "thresholds": v["thresholds"],
            "at_possible": v["metrics"]["test"]["at_possible"],
            "at_strong": v["metrics"]["test"]["at_strong"],
            "by_condition": v["metrics"]["test"]["by_condition"],
            "dataset": v["provenance"]["dataset"],
        }
    if args.write_calibration:
        update_summary("synthetic_detection", section)


if __name__ == "__main__":
    main()
