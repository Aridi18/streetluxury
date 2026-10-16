from __future__ import annotations

import json
from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .. import media
from ..analysis.base import PIPELINE_VERSION
from ..analysis.calibration import edit_calibration
from ..config import get_settings
from ..db import get_db
from ..jobs import queue
from ..models import User, WorkerHeartbeat, utcnow
from ..security import current_user

router = APIRouter(prefix="/api", tags=["system"])

SIGNAL_CHECKS = [
    (
        "bandwidth",
        "Bandwidth consistency",
        "spectral",
        "Tracks the upper-frequency cutoff of speech; persistent shifts suggest material from different recording or encoding chains.",
    ),
    (
        "noise_floor",
        "Background noise continuity",
        "background",
        "Compares the background noise in pauses before and after each instant.",
    ),
    (
        "noise_track",
        "Noise floor through speech",
        "background",
        "Minimum-statistics tracking of the per-band noise floor through continuous speech.",
    ),
    (
        "spectral_change",
        "Acoustic change (ΔBIC)",
        "spectral",
        "Bayesian Information Criterion change detection on speech cepstra (microphone/room/codec changes; also reacts to speaker changes).",
    ),
    (
        "discontinuity",
        "Waveform discontinuities",
        "waveform",
        "Isolated sub-3 ms clicks and DC-offset steps left by unfaded cuts.",
    ),
    (
        "digital_silence",
        "Digital silence",
        "waveform",
        "Exact digital silence inside a recording that otherwise has a noise floor; distinguishes noise-gate patterns.",
    ),
    ("level", "Speech level steps", "prosody", "Sustained steps in speech loudness (supporting evidence only)."),
    ("pitch", "Pitch continuity", "prosody", "F0 jumps inside continuous voicing (supporting evidence only)."),
    (
        "reverb",
        "Room acoustics continuity",
        "acoustics",
        "Truncated reverberation tails at word endings and changes in decay rate.",
    ),
    (
        "duplication",
        "Duplicated segments",
        "duplication",
        "Copy-move detection with audio fingerprints, verified by waveform correlation and sample identity.",
    ),
    ("enf", "Mains hum (ENF) continuity", "enf", "Phase continuity of 50/60 Hz mains hum, when a hum is present."),
]


def _load_json(name: str) -> dict | None:
    try:
        with open(get_settings().calibration_dir / name, encoding="utf-8") as fh:
            return json.load(fh)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


@router.get("/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "pipeline_version": PIPELINE_VERSION}


@router.get("/system/status")
def system_status(user: User = Depends(current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    now = utcnow()
    workers = []
    synthetic = None
    newest = None
    for hb in db.scalars(select(WorkerHeartbeat).order_by(WorkerHeartbeat.last_seen_at.desc())).all():
        seen = hb.last_seen_at if hb.last_seen_at.tzinfo else hb.last_seen_at.replace(tzinfo=now.tzinfo)
        online = now - seen < timedelta(seconds=60)
        workers.append(
            {
                "id": hb.worker_id,
                "hostname": hb.hostname,
                "online": online,
                "last_seen_at": seen.isoformat(),
                "current_job_id": hb.current_job_id,
            }
        )
        if online and newest is None:
            newest = hb
    if newest is not None:
        synthetic = (newest.detectors or {}).get("synthetic")
        source = f"reported by worker {newest.worker_id}"
    else:
        from ..jobs.worker import detector_status

        synthetic = detector_status()["synthetic"]
        source = "evaluated in the API process (no analysis worker is online)"
    cal = edit_calibration()
    return {
        "pipeline_version": PIPELINE_VERSION,
        "ffmpeg": media.ffmpeg_version(),
        "workers": workers,
        "workers_online": sum(w["online"] for w in workers),
        "queue": queue.queue_stats(db),
        "signal_checks": [
            {"id": i, "name": n, "family": f, "description": d, "state": "ready", "kind": "signal"}
            for i, n, f, d in SIGNAL_CHECKS
        ],
        "synthetic_detectors": synthetic,
        "synthetic_source": source,
        "calibration": {
            "editing": {"version": cal["version"], "provenance": cal["provenance"], "fusion": cal["fusion"]},
        },
        "evaluation": _load_json("evaluation_summary.json"),
        "storage": {
            "backend": settings.storage_backend,
            "encryption": "AES-256-GCM per object (chunked), keys derived with HKDF-SHA256",
            "public_urls": False,
        },
        "limits": {
            "max_upload_mb": settings.max_upload_mb,
            "max_duration_minutes": settings.max_duration_seconds / 60,
            "formats": media.SUPPORTED_DESCRIPTION,
        },
        "retention": {
            "default_days": settings.default_retention_days,
            "max_days": settings.max_retention_days,
            "reports_stored": False,
        },
        "rate_limiting": {
            "enabled": settings.rate_limit_enabled,
            "backend": "redis" if settings.redis_url else "memory",
        },
        "environment": settings.env,
    }
