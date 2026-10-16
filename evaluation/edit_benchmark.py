"""Edit/splice detection benchmark, calibration and evaluation.

Source audio: LibriSpeech dev-clean (CC BY 4.0), single utterances of >= 12 s.
Each utterance is a continuous excerpt of a LibriVox reading; LibriVox readers
sometimes edit their recordings, so "unedited" files may contain a few real
edits and the measured false-positive rates are upper bounds.

Speakers are split into a calibration half and a test half (no overlap). For
each selected utterance the benchmark creates the unedited version and one
edited version with exactly known splice times, using one of:

* ``cut_hard``             delete 0.5–2.5 s, butt splice
* ``cut_crossfade``        delete 0.5–2.5 s with a 20 ms crossfade
* ``insert_same_speaker``  insert 2–4 s of the same speaker from another chapter (another session)
* ``insert_other_speaker`` insert 2–4 s of a different speaker (level-matched)
* ``duplicate``            insert a copy of 0.6–1.5 s from elsewhere in the same utterance
* ``silence_insert``       insert 0.3–1.0 s of digital silence
* ``noisy_insert``         insert 2–4 s of the same speaker recorded in a noisier room (SNR 25 dB)
* ``bandlimited_insert``   insert 2–4 s of the same speaker through a 300–3400 Hz telephone band

Half of the splice points are placed in a pause (as an editor would), half in
running speech. Every file is then also rendered through MP3 (64 kbit/s) and
Opus (24 kbit/s, a messaging-app voice note setting).

Calibration (``--write-calibration``): family weights are set from the
per-family precision on the calibration half, the reporting threshold is the
lowest fused score that keeps false findings on unedited calibration audio
at or below 1 per 10 minutes, and the high-severity threshold at or below 0.2
per 10 minutes. All reported metrics are computed on the test half.

Usage::

    backend/.venv/bin/python evaluation/edit_benchmark.py --librispeech /data/LibriSpeech/dev-clean \
        --per-split 100 --workers 2 --write-calibration
"""

from __future__ import annotations

import argparse
import glob
import json
import os
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

from common import CALIBRATION, RESULTS, WORK, degrade, now, split_of, update_summary, write_json

SR = 16000
TYPES = [
    "cut_hard",
    "cut_crossfade",
    "insert_same_speaker",
    "insert_other_speaker",
    "duplicate",
    "silence_insert",
    "noisy_insert",
    "bandlimited_insert",
]
CODECS = ["wav", "mp3_64k", "opus_24k"]
TOL = 0.5


# --- Benchmark construction -----------------------------------------------------------


def catalogue(root: Path) -> list[dict]:
    out = []
    for f in sorted(glob.glob(str(root / "*" / "*" / "*.flac"))):
        info = sf.info(f)
        spk, chap = Path(f).parts[-3], Path(f).parts[-2]
        out.append({"path": f, "speaker": spk, "chapter": chap, "duration": info.duration})
    return out


def make_specs(cat: list[dict], per_split: int, seed: int = 2026) -> list[dict]:
    rng = np.random.default_rng(seed)
    specs = []
    for split in ("calibration", "test"):
        pool = [u for u in cat if split_of(u["speaker"]) == split]
        base = [u for u in pool if u["duration"] >= 12.0]
        picks = rng.permutation(len(base))[:per_split]
        for k, i in enumerate(picks):
            b = base[i]
            mtype = TYPES[k % len(TYPES)]
            same_spk_other_chap = [u for u in pool if u["speaker"] == b["speaker"] and u["chapter"] != b["chapter"]]
            same_spk = [u for u in pool if u["speaker"] == b["speaker"] and u["path"] != b["path"]]
            other_spk = [u for u in pool if u["speaker"] != b["speaker"]]
            donor_pool = {
                "insert_other_speaker": other_spk,
                "insert_same_speaker": same_spk_other_chap or same_spk,
                "noisy_insert": same_spk_other_chap or same_spk,
                "bandlimited_insert": same_spk_other_chap or same_spk,
            }.get(mtype)
            donor = donor_pool[rng.integers(len(donor_pool))]["path"] if donor_pool else None
            spec = {
                "id": f"{split}-{k:03d}",
                "split": split,
                "base": b["path"],
                "speaker": b["speaker"],
                "type": mtype,
                "donor": donor,
                "same_session_donor": bool(mtype == "insert_same_speaker" and not same_spk_other_chap),
                "at_pause": bool(k % 2 == 0),
                "seed": int(rng.integers(1 << 31)),
            }
            specs.append(spec)
    return specs


def _pauses(x: np.ndarray) -> list[tuple[float, float]]:
    from app.analysis.features import FRAME_S, compute_frames, voice_activity
    from app.analysis.dsp import bool_runs

    vad = voice_activity(compute_frames(x))
    return [(a * FRAME_S, b * FRAME_S) for a, b in bool_runs(~vad.speech) if (b - a) >= 15]


def _pick_point(x: np.ndarray, rng, at_pause: bool, margin: float = 3.0) -> float:
    dur = len(x) / SR
    if at_pause:
        cands = [(a + b) / 2 for a, b in _pauses(x) if margin < (a + b) / 2 < dur - margin]
        if cands:
            return float(cands[rng.integers(len(cands))])
    return float(rng.uniform(margin, dur - margin))


def _rms(x):
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2)) + 1e-9)


def _segment(path: str, rng, lo: float, hi: float) -> np.ndarray:
    y, _ = sf.read(path, dtype="float32")
    d = float(rng.uniform(lo, hi))
    n = int(d * SR)
    if len(y) <= n + SR:
        return y[: min(len(y), n)]
    s = int(rng.integers(int(0.5 * SR), len(y) - n - int(0.5 * SR)))
    return y[s : s + n]


def build(spec: dict) -> tuple[np.ndarray, np.ndarray, list[float], dict]:
    """Return (unedited, edited, ground-truth splice times in the edited file, info)."""
    rng = np.random.default_rng(spec["seed"])
    x, _ = sf.read(spec["base"], dtype="float32")
    t = _pick_point(x, rng, spec["at_pause"])
    i = int(t * SR)
    m = spec["type"]
    info: dict = {"point": t}
    if m in ("cut_hard", "cut_crossfade"):
        d = int(rng.uniform(0.5, 2.5) * SR)
        if m == "cut_hard":
            y = np.concatenate([x[:i], x[i + d :]])
        else:
            f = int(0.02 * SR)
            ramp = np.linspace(0, 1, f, dtype=np.float32)
            mid = x[i - f : i] * (1 - ramp) + x[i + d : i + d + f] * ramp
            y = np.concatenate([x[: i - f], mid, x[i + d + f :]])
        return x, y.astype(np.float32), [t], {**info, "removed_s": d / SR}
    if m == "silence_insert":
        d = int(rng.uniform(0.3, 1.0) * SR)
        y = np.concatenate([x[:i], np.zeros(d, np.float32), x[i:]])
        return x, y, [t, t + d / SR], {**info, "inserted_s": d / SR}
    if m == "duplicate":
        d = int(rng.uniform(0.6, 1.5) * SR)
        src = int(rng.uniform(0.5, len(x) / SR - 0.5 - d / SR) * SR)
        while abs(src - i) < d + SR // 2:
            src = int(rng.uniform(0.5, len(x) / SR - 0.5 - d / SR) * SR)
        seg = x[src : src + d].copy()
        y = np.concatenate([x[:i], seg, x[i:]])
        s_out = src / SR if src < i else src / SR + d / SR
        return x, y, [t, t + d / SR], {**info, "inserted_s": d / SR, "source": s_out}
    seg = _segment(spec["donor"], rng, 2.0, 4.0)
    seg = seg * (_rms(x) / _rms(seg))  # editors match levels
    if m == "noisy_insert":
        noise = degrade(seg, SR, "noise_snr25", rng) - seg
        seg = seg + noise
    elif m == "bandlimited_insert":
        from scipy import signal as sps

        from app.analysis.dsp import resample

        # Telephone channel: 8 kHz sampling (steep 4 kHz anti-alias cliff) + 300-3400 Hz band-pass.
        seg = resample(resample(seg.astype(np.float32), SR, 8000), 8000, SR)[: len(seg)]
        sos = sps.butter(4, [300, 3400], btype="bandpass", fs=SR, output="sos")
        seg = sps.sosfilt(sos, seg).astype(np.float32)
        seg = seg * (_rms(x) / _rms(seg))
    y = np.concatenate([x[:i], seg.astype(np.float32), x[i:]])
    return x, np.clip(y, -1, 1).astype(np.float32), [t, t + len(seg) / SR], {**info, "inserted_s": len(seg) / SR}


def codec(x: np.ndarray, name: str) -> np.ndarray:
    if name == "wav":
        return x
    if name == "mp3_64k":
        return degrade(x, SR, "mp3_64k")
    if name == "opus_24k":
        from common import _ffmpeg_roundtrip

        return _ffmpeg_roundtrip(x, SR, ["-c:a", "libopus", "-b:a", "24k"], "ogg")
    raise ValueError(name)


def run_detectors(x: np.ndarray, codec_name: str) -> list[dict]:
    from app.analysis.context import build_context
    from app.analysis.pipeline import SIGNAL_DETECTORS

    media = {"codec": {"wav": "pcm_s16le", "mp3_64k": "mp3", "opus_24k": "opus"}[codec_name],
             "container": codec_name, "sample_rate": SR, "channels": 1}
    ctx = build_context(x, SR, media=media)
    cands = []
    for det_id, _name, fn in SIGNAL_DETECTORS:
        try:
            out = fn(ctx)
        except Exception as exc:  # recorded, not hidden
            cands.append({"detector": det_id, "error": str(exc)})
            continue
        if out.status != "ok":
            continue
        for c in out.candidates:
            cands.append({"detector": c.detector, "family": c.family, "start": c.start, "end": c.end,
                          "strength": c.strength, "kind": c.kind, "related": c.related})
    return cands


def process(spec: dict) -> list[dict]:
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    out_dir = WORK / "edit"
    results = []
    unedited, edited, gt, info = build(spec)
    for cname in CODECS:
        for variant, sig, truth in (("unedited", unedited, []), ("edited", edited, gt)):
            key = f"{spec['id']}-{variant}-{cname}"
            path = out_dir / f"{key}.json"
            if path.exists():
                results.append(json.loads(path.read_text()))
                continue
            y = codec(sig, cname)
            rec = {"key": key, "spec": spec, "variant": variant, "codec": cname, "duration": len(y) / SR,
                   "gt": truth, "info": info, "candidates": run_detectors(y, cname)}
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(rec))
            results.append(rec)
    return results


# --- Scoring --------------------------------------------------------------------------


def fuse(cands: list[dict], weights: dict, tol: float) -> list[dict]:
    """Same clustering and noisy-OR as app.analysis.fusion, on cached candidates."""
    bound = sorted([c for c in cands if "family" in c and c["kind"] != "pair"], key=lambda c: c["start"])
    clusters: list[list[dict]] = []
    end = -np.inf
    for c in bound:
        if clusters and c["start"] - tol <= end and (c["end"] - clusters[-1][0]["start"]) < 3.0:
            clusters[-1].append(c)
            end = max(end, c["end"] + tol)
        else:
            clusters.append([c])
            end = c["end"] + tol
    out = []
    for members in clusters:
        fam: dict[str, float] = {}
        for c in members:
            fam[c["family"]] = max(fam.get(c["family"], 0.0), c["strength"])
        score = 1 - float(np.prod([1 - weights.get(f, 0.5) * s for f, s in fam.items()]))
        top = max(c["strength"] for c in members)
        core = [c for c in members if c["strength"] >= 0.5 * top]
        out.append({"start": min(c["start"] for c in core), "end": max(c["end"] for c in core),
                    "score": score, "families": fam})
    for c in cands:
        if c.get("kind") == "pair":
            rel = c.get("related") or {}
            out.append({"start": c["start"], "end": c["end"], "score": c["strength"],
                        "families": {"duplication": c["strength"]},
                        "alt": (rel.get("source_start"), rel.get("source_end"))})
    return out


def _covers(c: dict, g: float) -> bool:
    """A finding covers a ground-truth time; duplication pairs cover either occurrence."""
    if c["start"] - TOL <= g <= c["end"] + TOL:
        return True
    alt = c.get("alt")
    return bool(alt and alt[0] is not None and alt[0] - TOL <= g <= alt[1] + TOL)


def label_clusters(rec: dict, clusters: list[dict]) -> list[bool]:
    return [any(_covers(c, g) for g in rec["gt"]) for c in clusters]


def metrics(recs: list[dict], weights: dict, report: float, high: float, tol: float) -> dict:
    unedited_s = 0.0
    fp_unedited = fp_high = 0
    files_unedited = files_unedited_flagged = 0
    files_edited = files_edited_detected = 0
    tp = fp = 0
    boundary_total = boundary_hit = 0
    loc_err = []
    for r in recs:
        cl = [c for c in fuse(r["candidates"], weights, tol) if c["score"] >= report]
        if r["variant"] == "unedited":
            unedited_s += r["duration"]
            files_unedited += 1
            fp_unedited += len(cl)
            fp_high += sum(c["score"] >= high for c in cl)
            files_unedited_flagged += int(bool(cl))
            continue
        files_edited += 1
        lab = label_clusters(r, cl)
        tp += sum(lab)
        fp += len(lab) - sum(lab)
        hit_any = False
        for g in r["gt"]:
            boundary_total += 1
            m = [c for c in cl if _covers(c, g)]
            if m:
                boundary_hit += 1
                hit_any = True
                loc_err.append(min(min(abs(c["start"] - g), abs(c["end"] - g), abs((c["start"] + c["end"]) / 2 - g))
                                   if "alt" not in c else min(abs(x - g) for x in (c["start"], c["end"], *c["alt"]) if x is not None)
                                   for c in m))
        files_edited_detected += int(hit_any)
    minutes = unedited_s / 60
    return {
        "recall": boundary_hit / max(1, boundary_total),
        "file_detection_rate": files_edited_detected / max(1, files_edited),
        "precision": tp / max(1, tp + fp),
        "false_findings_per_10min": 10 * fp_unedited / max(minutes, 1e-9),
        "false_high_findings_per_10min": 10 * fp_high / max(minutes, 1e-9),
        "file_fpr": files_unedited_flagged / max(1, files_unedited),
        "file_fnr": 1 - files_edited_detected / max(1, files_edited),
        "median_localization_error_s": float(np.median(loc_err)) if loc_err else None,
        "boundaries": boundary_total,
        "edited_files": files_edited,
        "unedited_files": files_unedited,
        "unedited_minutes": minutes,
    }


def calibrate(recs: list[dict], defaults: dict, tol: float) -> tuple[dict, float, float, dict]:
    """Family weights from per-family precision; thresholds from false-finding budgets."""
    stats: dict[str, list[int]] = {}
    for r in recs:
        for c in fuse(r["candidates"], {f: 1.0 for f in defaults}, tol):
            if c["score"] < 0.3:
                continue
            top = max(c["families"], key=c["families"].get)
            hit = r["variant"] == "edited" and label_clusters(r, [c])[0]
            stats.setdefault(top, [0, 0])[0 if hit else 1] += 1
    weights = dict(defaults)
    family_stats = {}
    for fam, (hits, misses) in stats.items():
        n = hits + misses
        if n >= 10:
            ppv = hits / n
            weights[fam] = float(np.clip(ppv, 0.3, 1.0))
            family_stats[fam] = {"clusters": n, "precision": ppv}
    grid = np.round(np.arange(0.30, 0.99, 0.01), 2)
    report = next((float(t) for t in grid if metrics(recs, weights, t, 1.1, tol)["false_findings_per_10min"] <= 1.0), 0.98)
    high = next((float(t) for t in grid if t >= report and metrics(recs, weights, report, t, tol)["false_high_findings_per_10min"] <= 0.2), 0.99)
    return weights, report, high, family_stats


def breakdown(recs: list[dict], weights, report, high, tol) -> dict:
    by_type = []
    for m in TYPES:
        sub = [r for r in recs if r["spec"]["type"] == m and r["variant"] == "edited"]
        if sub:
            mm = metrics(sub, weights, report, high, tol)
            by_type.append({"type": m, "n": mm["edited_files"], "recall": mm["recall"],
                            "file_detection_rate": mm["file_detection_rate"],
                            "median_localization_error_s": mm["median_localization_error_s"]})
    by_codec = []
    for cname in CODECS:
        sub = [r for r in recs if r["codec"] == cname]
        mm = metrics(sub, weights, report, high, tol)
        by_codec.append({"condition": cname, "recall": mm["recall"], "precision": mm["precision"],
                         "false_findings_per_10min": mm["false_findings_per_10min"], "file_fpr": mm["file_fpr"]})
    by_position = []
    for pos in (True, False):
        sub = [r for r in recs if r["spec"]["at_pause"] == pos and r["variant"] == "edited"]
        mm = metrics(sub, weights, report, high, tol)
        by_position.append({"position": "in a pause" if pos else "in running speech", "recall": mm["recall"]})
    return {"by_manipulation": by_type, "by_condition": by_codec, "by_position": by_position}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--librispeech", type=Path, required=True)
    ap.add_argument("--per-split", type=int, default=100)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--write-calibration", action="store_true")
    args = ap.parse_args()

    from app.analysis.calibration import DEFAULT_FUSION

    cat = catalogue(args.librispeech)
    specs = make_specs(cat, args.per_split)
    print(f"{len(specs)} base utterances -> {len(specs) * 2 * len(CODECS)} files", flush=True)
    recs: list[dict] = []
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for k, res in enumerate(ex.map(process, specs, chunksize=1)):
            recs += res
            if (k + 1) % 10 == 0:
                print(f"  processed {k + 1}/{len(specs)}", flush=True)
    errors = [c for r in recs for c in r["candidates"] if "error" in c]
    if errors:
        print(f"WARNING: {len(errors)} detector errors, e.g. {errors[0]}")
    cal = [r for r in recs if r["spec"]["split"] == "calibration"]
    test = [r for r in recs if r["spec"]["split"] == "test"]
    tol = DEFAULT_FUSION["cluster_tolerance_s"]
    defaults = DEFAULT_FUSION["family_weights"]
    base_metrics = metrics(test, defaults, DEFAULT_FUSION["report_threshold"], DEFAULT_FUSION["high_threshold"], tol)
    weights, report, high, family_stats = calibrate(cal, defaults, tol)
    cal_metrics = metrics(cal, weights, report, high, tol)
    test_metrics = metrics(test, weights, report, high, tol)
    test_metrics_detail = breakdown(test, weights, report, high, tol)
    print(json.dumps({"weights": weights, "report": report, "high": high}, indent=1))
    print("calibration:", json.dumps(cal_metrics))
    print("test:", json.dumps(test_metrics))
    print("test (engineering defaults):", json.dumps(base_metrics))
    for row in test_metrics_detail["by_manipulation"]:
        print("  ", row)
    for row in test_metrics_detail["by_condition"] + test_metrics_detail["by_position"]:
        print("  ", row)

    n_spk = {s: len({r["spec"]["speaker"] for r in recs if r["spec"]["split"] == s}) for s in ("calibration", "test")}
    dataset = (f"Synthetic edits of LibriSpeech dev-clean utterances (CC BY 4.0): {len(specs)} base utterances "
               f"(speaker-disjoint: {n_spk['calibration']} calibration / {n_spk['test']} test speakers), one "
               f"manipulation each, rendered as WAV, MP3 64 kbit/s and Opus 24 kbit/s")
    limitations = ("Edits were generated programmatically on read audiobook speech, so they represent common but "
                   "not all editing practices (no manual crossfade tuning, room-tone matching or re-recording). "
                   "Unedited LibriSpeech utterances may contain edits made by LibriVox readers, so false-positive "
                   "rates are upper bounds. Performance on conversational, multi-speaker or far-field recordings "
                   "has not been measured.")
    record = {
        "version": f"bench-{now()[:10]}",
        "created_at": now(),
        "provenance": {
            "source": "Audio Sentinel edit benchmark (evaluation/edit_benchmark.py)",
            "validated": True,
            "dataset": dataset,
            "procedure": "Family weights = per-family precision on the calibration half (clipped to [0.3, 1]); "
                         "report threshold = lowest fused score with <= 1 false finding per 10 min of unedited "
                         "calibration audio; high threshold = <= 0.2 false high-severity findings per 10 min.",
            "note": f"Held-out test: boundary recall {test_metrics['recall']:.0%}, finding precision "
                    f"{test_metrics['precision']:.0%}, {test_metrics['false_findings_per_10min']:.2f} false findings "
                    "per 10 min of unedited audio.",
        },
        "fusion": {"family_weights": weights, "report_threshold": report, "high_threshold": high},
        "family_statistics": family_stats,
        "metrics": {"calibration": cal_metrics, "test": test_metrics, "test_engineering_defaults": base_metrics},
    }
    write_json(RESULTS / "edit_benchmark.json", {**record, "test_breakdown": test_metrics_detail})
    if args.write_calibration:
        write_json(CALIBRATION / "edit_detectors.json", record)
        update_summary("edit_detection", {
            "dataset": dataset,
            "limitations": limitations,
            "thresholds": {"report": report, "high": high},
            "test": {**test_metrics, "overall": {k: test_metrics[k] for k in (
                "recall", "precision", "false_findings_per_10min", "file_fpr", "file_fnr")}, **test_metrics_detail},
        })


if __name__ == "__main__":
    main()
