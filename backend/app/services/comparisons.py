from __future__ import annotations

import shutil

import numpy as np
from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import media
from ..analysis import comparison
from ..analysis.base import PIPELINE_VERSION
from ..analysis.dsp import resample
from ..db import get_sessionmaker
from ..jobs import queue
from ..models import Comparison, Recording, User, utcnow
from ..storage import get_store, secure_tempdir
from . import audit
from .analyses import file_summary


def create(db: Session, user: User, original: Recording, suspect: Recording) -> Comparison:
    c = Comparison(
        owner_id=user.id,
        original_id=original.id,
        suspect_id=suspect.id,
        status="queued",
        stage="Waiting for an analysis worker",
        pipeline_version=PIPELINE_VERSION,
    )
    db.add(c)
    db.flush()
    queue.enqueue(db, "comparison", {"comparison_id": c.id}, commit=False)
    audit.record(
        db, user.id, "comparison.requested", "comparison", c.id, {"original_id": original.id, "suspect_id": suspect.id}
    )
    db.commit()
    return c


def _decode16(rec: Recording, tmp) -> np.ndarray:
    src = tmp / f"{rec.id}.bin"
    get_store().download_to(rec.assets["original"], src)
    fmt = media.FORMATS[rec.detected_format]
    sr = media.analysis_sample_rate(rec.sample_rate or 16000)
    x = media.decode(src, fmt, sr)
    src.unlink(missing_ok=True)
    return resample(x, sr, 16000)


def run_job(db: Session, comparison_id: str) -> None:
    c = db.get(Comparison, comparison_id)
    if c is None or c.status in ("succeeded", "cancelled"):
        return
    a, b = db.get(Recording, c.original_id), db.get(Recording, c.suspect_id)
    if a is None or b is None:
        return
    if "processing" in (a.status, b.status):
        raise queue.Defer(5, "recordings are still being processed")
    for r in (a, b):
        if r.status != "ready" or not r.assets.get("original"):
            c.status = "failed"
            c.error = f"Audio for '{r.original_filename}' is not available."
            c.finished_at = utcnow()
            db.commit()
            return
    c.status = "running"
    c.started_at = utcnow()
    c.stage = "Decoding audio"
    db.commit()

    def progress(stage: str, frac: float) -> None:
        with get_sessionmaker()() as s:
            s.execute(
                update(Comparison)
                .where(Comparison.id == comparison_id)
                .values(stage=stage[:80], progress=round(0.1 + 0.85 * frac, 3))
            )
            s.commit()

    tmp = secure_tempdir("compare-")
    try:
        xa = _decode16(a, tmp)
        xb = _decode16(b, tmp)
        result = comparison.compare(xa, xb, progress=progress)
        result["original"] = file_summary(a)
        result["suspect"] = file_summary(b)
        db.refresh(c)
        c.result = result
        c.status = "succeeded"
        c.stage = "Complete"
        c.progress = 1.0
        c.finished_at = utcnow()
        audit.record(
            db,
            c.owner_id,
            "comparison.completed",
            "comparison",
            c.id,
            {"splice_points": result["summary"]["splice_points"]},
        )
        db.commit()
    except media.MediaError as exc:
        db.rollback()
        c = db.get(Comparison, comparison_id)
        c.status = "failed"
        c.error = str(exc)
        c.finished_at = utcnow()
        db.commit()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def mark_failed(db: Session, comparison_id: str, error: str) -> None:
    c = db.get(Comparison, comparison_id)
    if c and c.status not in ("succeeded", "cancelled"):
        c.status = "failed"
        c.error = error[:2000]
        c.finished_at = utcnow()
        db.commit()
