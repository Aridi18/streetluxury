"""Analysis orchestration: run detectors, fuse evidence, build the result document."""

from __future__ import annotations

import logging
import platform
import time
import traceback
from datetime import UTC, datetime
from importlib import metadata as importlib_metadata
from typing import Any

import numpy as np

from .. import media as media_mod
from . import fusion, metadata, quality
from .base import PIPELINE_VERSION, AnalysisCancelled, DetectorOutput, ProgressFn, jsonable
from .calibration import edit_calibration, synthetic_calibration
from .context import build_context
from .detectors import (
    bandwidth,
    digital_silence,
    discontinuity,
    duplication,
    enf,
    noise_floor,
    prosody,
    reverb,
    spectral_change,
)
from .synthetic import configure_torch, enabled_detectors, run_detector

log = logging.getLogger(__name__)

# Order matters: bandwidth runs first because later detectors use its estimate.
SIGNAL_DETECTORS = [
    ("bandwidth", "Bandwidth consistency", bandwidth.run),
    ("noise_floor", "Background noise continuity", noise_floor.run),
    ("spectral_change", "Acoustic change (ΔBIC)", spectral_change.run),
    ("discontinuity", "Waveform discontinuities", discontinuity.run),
    ("digital_silence", "Digital silence", digital_silence.run),
    ("level", "Speech level steps", prosody.run_level),
    ("pitch", "Pitch continuity", prosody.run_pitch),
    ("reverb", "Room acoustics continuity", reverb.run),
    ("duplication", "Duplicated segments", duplication.run),
    ("enf", "Mains hum (ENF) continuity", enf.run),
]

STATIC_LIMITATIONS = [
    "Signal checks detect common traces of editing. Careful edits (crossfaded cuts, matched room tone, "
    "re-recording through a loudspeaker) can leave no detectable trace.",
    "Synthetic-speech models recognise artefacts of generators similar to those in their training data. "
    "New or unseen generators, and audio that was re-recorded or heavily processed, can be missed.",
    "Window-level synthetic-speech scores come from utterance-level classifiers; they approximate, but do "
    "not precisely localise, partially synthetic audio.",
    "A flagged interval is an indicator for expert review, not a confirmed manipulation.",
    "This system does not identify speakers and does not determine which tool generated any audio.",
]


def _versions() -> dict[str, str]:
    out = {"python": platform.python_version(), "ffmpeg": media_mod.ffmpeg_version()}
    for pkg in ("numpy", "scipy", "librosa", "torch", "transformers"):
        try:
            out[pkg] = importlib_metadata.version(pkg)
        except importlib_metadata.PackageNotFoundError:
            pass
    return out


def run(
    x: np.ndarray,
    sr: int,
    *,
    media: dict,
    size_bytes: int,
    uploaded_at: datetime | None,
    offset: float = 0.0,
    scope_end: float | None = None,
    whole_file: bool = True,
    progress: ProgressFn | None = None,
    cancel_check=None,
    run_synthetic: bool = True,
) -> dict[str, Any]:
    t_start = time.perf_counter()
    timing: dict[str, float] = {}

    def prog(stage: str, frac: float) -> None:
        if cancel_check and cancel_check():
            raise AnalysisCancelled()
        if progress:
            progress(stage, frac)

    prog("Computing features", 0.05)
    t0 = time.perf_counter()
    ctx = build_context(x, sr, offset=offset, media=media, progress_fn=progress, cancel_check=cancel_check)
    timing["features"] = time.perf_counter() - t0

    outputs: list[DetectorOutput] = []
    n = len(SIGNAL_DETECTORS)
    for i, (det_id, name, fn) in enumerate(SIGNAL_DETECTORS):
        prog(f"Signal check: {name}", 0.10 + 0.45 * i / n)
        t0 = time.perf_counter()
        try:
            out = fn(ctx)
        except AnalysisCancelled:
            raise
        except Exception as exc:  # isolate detector failures
            log.exception("detector %s failed", det_id)
            out = DetectorOutput(
                id=det_id,
                name=name,
                family="unknown",
                version="?",
                method="",
                status="failed",
                status_detail=f"{type(exc).__name__}: {exc}"[:300],
            )
            out.summary["traceback"] = traceback.format_exc(limit=3)[-1500:]
        out.runtime_s = time.perf_counter() - t0
        timing[det_id] = out.runtime_s
        outputs.append(out)

    quality_res = quality.assess(ctx, media)

    if run_synthetic:
        configure_torch()
        dets = enabled_detectors()
        for i, det in enumerate(dets):
            prog(f"Model inference: {det.info.name}", 0.55 + 0.35 * i / max(1, len(dets)))
            t0 = time.perf_counter()
            try:
                out = run_detector(ctx, det)
            except AnalysisCancelled:
                raise
            except Exception as exc:
                log.exception("synthetic detector %s failed", det.info.id)
                out = DetectorOutput(
                    id=det.info.id,
                    name=det.info.name,
                    family="synthetic",
                    version=det.info.version,
                    method=det.info.architecture,
                    kind="ml",
                    status="failed",
                    status_detail=f"Model inference failed ({type(exc).__name__}: {exc})"[:300],
                )
            out.runtime_s = time.perf_counter() - t0
            timing[det.info.id] = out.runtime_s
            outputs.append(out)

    prog("Combining evidence", 0.93)
    edit = fusion.fuse_edits(outputs)
    edit_a = fusion.assess_edits(edit, outputs, quality_res)
    synth_a = fusion.assess_synthetic(outputs, quality_res)
    meta = metadata.analyse(
        media,
        decoded_duration=ctx.duration if whole_file else float(media.get("duration_seconds") or ctx.duration),
        size_bytes=size_bytes,
        uploaded_at=uploaded_at,
        effective_bandwidth_hz=ctx.cache.get("effective_bandwidth_hz"),
    )
    overall = fusion.overall(edit_a, synth_a, quality_res)

    findings = edit["findings"] + synth_a["findings"]
    findings.sort(key=lambda f: (f["start"], f["category"]))
    for i, f in enumerate(findings, 1):
        f["id"] = f"F-{i:03d}"
        f["confirmed"] = False
        f["basis"] = "model inference" if f["category"] == "synthetic" else "signal analysis"
        ev = f["evidence"]
        f["summary"] = ev[0]["explanation"] if ev else ""
        f["supporting"] = [
            {
                "detector": e["detector"],
                "family": e["family"],
                "strength": e["strength"],
                "explanation": e["explanation"],
            }
            for e in ev
        ]
        alts: list[str] = []
        for e in ev:
            for a in e.get("alternatives", []):
                if a not in alts:
                    alts.append(a)
        f["alternatives"] = alts[:6]
    for i, o in enumerate(edit["observations"], 1):
        o["id"] = f"O-{i:03d}"

    limitations = list(STATIC_LIMITATIONS)
    for issue in quality_res["issues"]:
        if issue["severity"] in ("warning", "severe"):
            limitations.append(f"{issue['title']}: {issue['detail']}")
    if not whole_file:
        limitations.append(
            "Only the selected segment was analysed. Evidence within about 2 seconds of the segment "
            "edges is limited because detectors compare audio on both sides of each instant."
        )
    if not edit_calibration()["provenance"].get("validated", False):
        limitations.append(
            "Edit-detection thresholds are engineering defaults that have not been validated on an evaluation set."
        )

    synthetic_detail = {}
    for o in outputs:
        if o.kind == "ml":
            synthetic_detail[o.id] = {
                "status": o.status,
                "status_detail": o.status_detail,
                **{k: v for k, v in o.summary.items()},
            }

    prog("Finalising", 0.98)
    timing["total"] = time.perf_counter() - t_start
    result = {
        "pipeline_version": PIPELINE_VERSION,
        "analysed_at": datetime.now(UTC).isoformat(),
        "scope": {
            "whole_file": whole_file,
            "start": offset,
            "end": scope_end if scope_end is not None else offset + ctx.duration,
        },
        "overall": overall,
        "assessments": {"editing": edit_a, "synthetic": {k: v for k, v in synth_a.items() if k != "findings"}},
        "findings": findings,
        "observations": edit["observations"],
        "thresholds": edit["thresholds"],
        "synthetic": synthetic_detail,
        "detectors": [o.to_dict() for o in outputs],
        "quality": quality_res,
        "metadata": meta,
        "speech_segments": [[round(ctx.abs_time(a), 3), round(ctx.abs_time(b), 3)] for a, b in ctx.vad.segments][:5000],
        "recommendations": fusion.recommendations(edit_a, synth_a, quality_res, meta),
        "limitations": limitations,
        "calibration": {
            "editing": {"version": edit["calibration_version"], **edit["calibration"]},
            "synthetic": {
                d.info.id: (synthetic_calibration(d.info.id) or {}).get("provenance") for d in enabled_detectors()
            },
        },
        "environment": {"analysis_sample_rate": sr, "versions": _versions()},
        "timing": timing,
    }
    return jsonable(result)
