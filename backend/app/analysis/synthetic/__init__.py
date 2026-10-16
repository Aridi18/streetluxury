"""Synthetic-speech (deepfake) detection models.

Detectors are pluggable: each implements :class:`SyntheticDetector`, declares
its provenance and licence, and reports whether it is usable on this server
(dependencies installed, weights present). A detector that is not usable is
reported as "Detection model not configured"; it never produces scores.

Whether a detector's output may influence the verdict is decided by its
calibration file (``calibration/synthetic/<id>.json``), produced by the
evaluation suite on held-out data. Uncalibrated detectors are displayed as raw
scores only.
"""

from __future__ import annotations

import threading
import time
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any

import numpy as np

from ...config import get_settings
from ..base import Candidate, DetectorOutput
from ..calibration import synthetic_calibration
from ..context import AnalysisContext
from ..features import FRAME_S, SR16

WINDOW_S = 4.0
HOP_S = 2.0
MIN_SPEECH_S = 1.0


@dataclass
class ModelInfo:
    id: str
    name: str
    version: str
    architecture: str
    training_data: str
    license: str
    license_url: str
    commercial_use: bool
    source_url: str
    paper: str
    published_results: list[dict[str, Any]] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)


class SyntheticDetector(ABC):
    info: ModelInfo
    _lock: threading.Lock

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._model = None
        self._load_error: str | None = None

    @abstractmethod
    def availability(self) -> tuple[str, str | None]:
        """Return ("ready" | "not_configured" | "unavailable", detail)."""

    @abstractmethod
    def _load(self) -> Any: ...

    @abstractmethod
    def _scores(self, model: Any, windows: list[np.ndarray]) -> np.ndarray:
        """Raw scores (log-odds of synthetic; higher = more likely synthetic)."""

    def model(self) -> Any:
        with self._lock:
            if self._model is None:
                self._model = self._load()
            return self._model

    def raw_scores(self, windows: list[np.ndarray], batch: int = 8) -> np.ndarray:
        m = self.model()
        out = []
        for i in range(0, len(windows), batch):
            out.append(self._scores(m, windows[i : i + batch]))
        return np.concatenate(out) if out else np.zeros(0)

    def status(self) -> dict[str, Any]:
        state, detail = self.availability()
        cal = synthetic_calibration(self.info.id)
        return {
            **asdict(self.info),
            "state": state,
            "detail": detail,
            "loaded": self._model is not None,
            "calibration": _cal_summary(cal),
        }


def _cal_summary(cal: dict | None) -> dict[str, Any]:
    if not cal:
        return {
            "calibrated": False,
            "use_for_verdict": False,
            "note": "No calibration file: raw scores are shown but cannot drive the verdict.",
        }
    return {
        "calibrated": True,
        "use_for_verdict": bool(cal.get("use_for_verdict", False)),
        "thresholds": cal.get("thresholds"),
        "provenance": cal.get("provenance"),
        "metrics": cal.get("metrics"),
        "created_at": cal.get("created_at"),
    }


@lru_cache
def registry() -> dict[str, SyntheticDetector]:
    from .aasist import AasistDetector
    from .antideepfake import AntiDeepfakeDetector

    all_detectors: list[SyntheticDetector] = [AntiDeepfakeDetector(), AasistDetector()]
    return {d.info.id: d for d in all_detectors}


def enabled_detectors() -> list[SyntheticDetector]:
    reg = registry()
    return [reg[i] for i in get_settings().enabled_synthetic_detectors if i in reg]


def configure_torch() -> None:
    try:
        import torch
    except ImportError:
        return
    n = get_settings().torch_threads
    if n > 0:
        torch.set_num_threads(n)


def sigmoid(x: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(x, -50, 50)))


def make_windows(ctx: AnalysisContext) -> list[dict[str, Any]]:
    """Overlapping 4 s windows (2 s hop) containing at least 1 s of speech."""
    dur = len(ctx.x16) / SR16
    speech = ctx.vad.speech
    starts: list[float]
    if dur <= WINDOW_S:
        starts = [0.0]
    else:
        starts = list(np.arange(0.0, dur - WINDOW_S + 1e-6, HOP_S))
        if dur - (starts[-1] + WINDOW_S) > 0.5:
            starts.append(dur - WINDOW_S)
    out = []
    for s in starts:
        e = min(dur, s + WINDOW_S)
        f0, f1 = int(s / FRAME_S), int(e / FRAME_S)
        sp = float(speech[f0:f1].sum() * FRAME_S)
        out.append({"start": float(s), "end": float(e), "speech_s": sp, "scored": sp >= MIN_SPEECH_S})
    return out


def run_detector(ctx: AnalysisContext, det: SyntheticDetector) -> DetectorOutput:
    info = det.info
    out = DetectorOutput(
        id=info.id,
        name=info.name,
        family="synthetic",
        version=info.version,
        kind="ml",
        method=(
            f"{info.architecture}. Scores overlapping {WINDOW_S:.0f} s windows ({HOP_S:.0f} s hop) "
            f"containing at least {MIN_SPEECH_S:.0f} s of speech."
        ),
    )
    state, detail = det.availability()
    if state != "ready":
        out.status = "skipped"
        out.status_detail = detail or "Detection model not configured."
        out.summary["state"] = state
        return out
    t0 = time.perf_counter()
    windows = make_windows(ctx)
    scored = [w for w in windows if w["scored"]]
    out.summary["windows_total"] = len(windows)
    out.summary["windows_scored"] = len(scored)
    if not scored:
        out.status = "not_applicable"
        out.status_detail = "Not enough speech in any window for this model."
        out.summary["windows"] = windows
        return out
    segs = [ctx.x16[int(w["start"] * SR16) : int(w["end"] * SR16)] for w in scored]
    raw = det.raw_scores(segs)
    cal = synthetic_calibration(info.id)
    calibrated = cal is not None and "platt" in cal
    for w, r in zip(scored, raw, strict=True):
        w["raw_score"] = float(r)
        w["p_model"] = float(sigmoid(np.array([r]))[0])
        if calibrated:
            a, b = cal["platt"]["a"], cal["platt"]["b"]
            w["p_calibrated"] = float(sigmoid(np.array([a * r + b]))[0])
    thresholds = (cal or {}).get("thresholds") or {}
    for w in windows:
        w["start"] = ctx.abs_time(w["start"])
        w["end"] = ctx.abs_time(w["end"])
        p = w.get("p_calibrated")
        if p is None:
            w["flag"] = None
        elif p >= thresholds.get("strong", 1.1):
            w["flag"] = "strong"
        elif p >= thresholds.get("possible", 1.1):
            w["flag"] = "possible"
        else:
            w["flag"] = "none"
    p_key = "p_calibrated" if calibrated else "p_model"
    ps = np.array([w[p_key] for w in scored])
    out.summary.update(
        windows=windows,
        calibrated=calibrated,
        use_for_verdict=bool(calibrated and cal.get("use_for_verdict", False)),
        thresholds=thresholds or None,
        probability_key=p_key,
        mean_probability=float(ps.mean()),
        median_probability=float(np.median(ps)),
        max_probability=float(ps.max()),
        sustained_max_probability=float(_sustained_max(ps)),
        fraction_possible=float(np.mean([w["flag"] in ("possible", "strong") for w in scored])) if calibrated else None,
        fraction_strong=float(np.mean([w["flag"] == "strong" for w in scored])) if calibrated else None,
        calibration_provenance=(cal or {}).get("provenance"),
        model=asdict(info),
    )
    if calibrated:
        out.candidates = _regions(windows, info.id, thresholds)
    out.runtime_s = time.perf_counter() - t0
    return out


def _sustained_max(ps: np.ndarray) -> float:
    """Highest probability held by two consecutive scored windows (robust to one-offs)."""
    if ps.size == 1:
        return float(ps[0])
    return float(np.max(np.minimum(ps[:-1], ps[1:])))


def _regions(windows: list[dict], det_id: str, thresholds: dict) -> list[Candidate]:
    flagged = [w for w in windows if w.get("flag") in ("possible", "strong")]
    regions: list[list[dict]] = []
    for w in flagged:
        if regions and w["start"] <= regions[-1][-1]["end"] + 1e-6:
            regions[-1].append(w)
        else:
            regions.append([w])
    out = []
    for r in regions:
        ps = [w["p_calibrated"] for w in r]
        strong = sum(w["flag"] == "strong" for w in r)
        out.append(
            Candidate(
                detector=det_id,
                family="synthetic",
                kind="interval",
                start=r[0]["start"],
                end=r[-1]["end"],
                strength=float(max(ps)),
                measurements={
                    "windows": len(r),
                    "strong_windows": strong,
                    "max_probability": float(max(ps)),
                    "mean_probability": float(np.mean(ps)),
                    "threshold_possible": thresholds.get("possible"),
                    "threshold_strong": thresholds.get("strong"),
                },
                explanation=(
                    f"{len(r)} overlapping window(s) score above the calibrated threshold for "
                    f"synthetic speech (highest calibrated probability {max(ps):.2f})."
                ),
                alternatives=[
                    "Heavy noise suppression, voice-changer filters or extreme compression can "
                    "resemble synthesis artefacts.",
                    "Recording conditions unlike the calibration data.",
                ],
            )
        )
    return out
