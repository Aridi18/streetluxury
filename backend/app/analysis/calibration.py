"""Calibration parameters for detectors and decision thresholds.

Every threshold that influences a reported finding or verdict comes from one of
the JSON files in ``AS_CALIBRATION_DIR``. Each file records the dataset and
procedure that produced it (see ``evaluation/``). When a file is missing, the
built-in engineering defaults below are used and the report says so.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..config import get_settings

# Raw-statistic -> strength mappings (logistic midpoint/scale in the statistic's units).
DEFAULT_EDIT_PARAMS: dict[str, Any] = {
    "noise_floor": {"midpoint_db": 6.0, "scale_db": 1.5, "min_db": 3.0, "min_z": 4.0},
    "noise_track": {"midpoint_db": 8.0, "scale_db": 2.0, "min_db": 5.0, "min_z": 4.0, "min_t": 2.5},
    "bandwidth": {"min_shift_hz": 1000.0, "cliff_db": 25.0, "adaptive_codec_factor": 0.4},
    "spectral_change": {"midpoint": 1.2, "scale": 0.3, "min_z": 5.0, "max_strength": 0.5},
    "discontinuity": {"midpoint_db": 30.0, "scale_db": 4.0, "min_ratio_db": 22.0, "max_strength": 0.45},
    "digital_silence": {"min_ms": 10.0, "gate_fraction": 0.5},
    "level_dc": {
        "level_midpoint_db": 11.0,
        "level_scale_db": 2.0,
        "level_max_strength": 0.45,
        "dc_midpoint": 8.0,
        "dc_scale": 2.0,
    },
    "pitch": {"midpoint_st": 5.5, "scale_st": 1.0, "min_st": 4.0, "max_strength": 0.5},
    "reverb": {
        "abrupt_min_db": 15.0,
        "abrupt_midpoint_z": 4.0,
        "abrupt_scale_z": 1.0,
        "abrupt_max_strength": 0.55,
        "decay_ratio_min": 2.0,
        "decay_max_strength": 0.35,
    },
    "duplication": {"min_seconds": 0.4, "max_ber": 0.22, "min_corr": 0.6},
    "enf": {"min_snr_db": 10.0, "spike_z": 8.0},
}

DEFAULT_FUSION: dict[str, Any] = {
    "family_weights": {
        "background": 0.9,
        "spectral": 0.9,
        "waveform": 0.85,
        "prosody": 0.6,
        "acoustics": 0.6,
        "enf": 0.95,
        "duplication": 1.0,
    },
    "cluster_tolerance_s": 0.3,
    "observation_threshold": 0.25,
    "report_threshold": 0.5,
    "high_threshold": 0.8,
}


def _load(path: Path) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return None


@lru_cache
def edit_calibration() -> dict[str, Any]:
    data = _load(get_settings().calibration_dir / "edit_detectors.json") or {}
    params = {k: {**v, **data.get("detectors", {}).get(k, {})} for k, v in DEFAULT_EDIT_PARAMS.items()}
    fusion = {**DEFAULT_FUSION, **data.get("fusion", {})}
    fusion["family_weights"] = {
        **DEFAULT_FUSION["family_weights"],
        **data.get("fusion", {}).get("family_weights", {}),
    }
    return {
        "detectors": params,
        "fusion": fusion,
        "provenance": data.get("provenance")
        or {
            "source": "engineering defaults",
            "validated": False,
            "note": "No benchmark calibration file was found; thresholds are the documented "
            "engineering defaults and have not been validated on an evaluation set.",
        },
        "version": data.get("version", "defaults"),
    }


def edit_params(detector: str) -> dict[str, Any]:
    return edit_calibration()["detectors"][detector]


@lru_cache
def synthetic_calibration(detector_id: str) -> dict[str, Any] | None:
    """Return the calibration record for a synthetic-speech detector, if any.

    Expected keys: ``platt`` {"a", "b"} mapping the model's raw score s to
    P(synthetic) = 1 / (1 + exp(-(a*s + b))); ``thresholds`` {"possible",
    "strong"} on that probability; ``provenance`` and ``metrics``.
    """
    return _load(get_settings().calibration_dir / "synthetic" / f"{detector_id}.json")


def clear_caches() -> None:
    edit_calibration.cache_clear()
    synthetic_calibration.cache_clear()
