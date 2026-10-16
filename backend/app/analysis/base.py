"""Shared data structures for the analysis pipeline."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import numpy as np

PIPELINE_VERSION = "1.0.0"

Family = Literal["background", "spectral", "waveform", "prosody", "acoustics", "enf", "duplication", "synthetic"]

FAMILY_LABELS: dict[str, str] = {
    "background": "Background noise",
    "spectral": "Spectral / bandwidth",
    "waveform": "Waveform",
    "prosody": "Level & pitch",
    "acoustics": "Room acoustics",
    "enf": "Mains hum (ENF)",
    "duplication": "Duplicated audio",
    "synthetic": "Synthetic speech model",
}


class AnalysisCancelled(Exception):
    pass


@dataclass
class Candidate:
    """A localized observation produced by one detector.

    ``strength`` is the detector's evidence strength in [0, 1] after the
    detector-specific normalisation documented in ``calibration``. It is *not* a
    probability that the audio was edited.
    """

    detector: str
    family: str
    start: float
    end: float
    strength: float
    measurements: dict[str, Any]
    explanation: str
    alternatives: list[str] = field(default_factory=list)
    related: dict[str, Any] | None = None
    kind: Literal["boundary", "interval", "pair"] = "boundary"

    @property
    def center(self) -> float:
        return 0.5 * (self.start + self.end)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["strength"] = round(float(self.strength), 4)
        d["start"] = round(float(self.start), 4)
        d["end"] = round(float(self.end), 4)
        d["measurements"] = _jsonable(self.measurements)
        if self.related:
            d["related"] = _jsonable(self.related)
        return d


@dataclass
class DetectorOutput:
    id: str
    name: str
    family: str
    version: str
    method: str
    status: Literal["ok", "not_applicable", "failed", "skipped"] = "ok"
    status_detail: str | None = None
    candidates: list[Candidate] = field(default_factory=list)
    summary: dict[str, Any] = field(default_factory=dict)
    runtime_s: float = 0.0
    kind: Literal["signal", "ml"] = "signal"

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "family": self.family,
            "version": self.version,
            "kind": self.kind,
            "method": self.method,
            "status": self.status,
            "status_detail": self.status_detail,
            "summary": _jsonable(self.summary),
            "runtime_s": round(self.runtime_s, 3),
            "n_candidates": len(self.candidates),
        }


ProgressFn = Callable[[str, float], None]


def _jsonable(obj: Any) -> Any:
    if isinstance(obj, dict):
        return {str(k): _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    if isinstance(obj, (np.floating, float)):
        v = float(obj)
        if not np.isfinite(v):
            return None
        return round(v, 6)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return _jsonable(obj.tolist())
    return obj


jsonable = _jsonable


def logistic(x: float, midpoint: float, scale: float) -> float:
    """Map a raw statistic to (0, 1). ``scale`` is the distance from midpoint to ~0.73."""
    z = (x - midpoint) / max(scale, 1e-9)
    return float(1.0 / (1.0 + np.exp(-np.clip(z, -50, 50))))
