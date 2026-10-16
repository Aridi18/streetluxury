"""Analysis job lifecycle."""

from __future__ import annotations

import logging
import shutil
import time

from sqlalchemy import update
from sqlalchemy.orm import Session

from .. import media
from ..analysis import pipeline
from ..analysis.base import PIPELINE_VERSION, AnalysisCancelled
from ..db import get_sessionmaker
from ..jobs import queue
from ..models import Analysis, Recording, User, utcnow
from ..storage import get_store, secure_tempdir
from . import audit, recordings

log = logging.getLogger(__name__)


def create(
    db: Session, user: User, rec: Recording, *, start: float | None, end: float | None, run_synthetic: bool
) -> Analysis:
    a = Analysis(
        owner_id=user.id,
        recording_id=rec.id,
        status="queued",
        stage="Waiting for an analysis worker",
        segment_start=start,
        segment_end=end,
        options={"run_synthetic": run_synthetic},
        pipeline_version=PIPELINE_VERSION,
    )
    db.add(a)
    db.flush()
    queue.enqueue(db, "analysis", {"analysis_id": a.id}, commit=False)
    audit.record(db, user.id, "analysis.requested", "analysis", a.id, {"recording_id": rec.id, "segment": [start, end]})
    db.commit()
    return a


class _Progress:
    """Throttled progress writer using its own short transactions."""

    def __init__(self, analysis_id: str):
        self.analysis_id = analysis_id
        self._last = 0.0
        self.cancelled = False

    def __call__(self, stage: str, fraction: float) -> None:
        now = time.monotonic()
        if now - self._last < 0.5 and fraction < 0.99:
            return
        self._last = now
        with get_sessionmaker()() as s:
            s.execute(
                update(Analysis)
                .where(Analysis.id == self.analysis_id)
                .values(stage=stage[:80], progress=round(min(0.99, fraction), 3))
            )
            row = s.get(Analysis, self.analysis_id)
            self.cancelled = bool(row is None or row.cancel_requested)
            s.commit()

    def check_cancel(self) -> bool:
        return self.cancelled


def run_job(db: Session, analysis_id: str) -> None:
    a = db.get(Analysis, analysis_id)
    if a is None or a.status in ("succeeded", "cancelled"):
        return
    rec = db.get(Recording, a.recording_id)
    if rec is None:
        return
    if a.cancel_requested:
        a.status = "cancelled"
        a.finished_at = utcnow()
        db.commit()
        return
    if rec.status == "processing":
        raise queue.Defer(5, "recording is still being processed")
    if rec.status != "ready" or not rec.assets.get("original"):
        a.status = "failed"
        a.error = rec.error or "The recording's audio is not available (it may have been deleted)."
        a.finished_at = utcnow()
        db.commit()
        return
    a.status = "running"
    a.started_at = utcnow()
    a.stage = "Decoding audio"
    a.progress = 0.01
    db.commit()

    prog = _Progress(a.id)
    tmp = secure_tempdir("analysis-")
    try:
        src = tmp / "original"
        get_store().download_to(rec.assets["original"], src)
        fmt = media.FORMATS[rec.detected_format]
        sr = media.analysis_sample_rate(rec.sample_rate or 16000)
        x = media.decode(src, fmt, sr)
        src.unlink(missing_ok=True)
        whole = a.segment_start is None and a.segment_end is None
        offset = 0.0
        scope_end = None
        if not whole:
            s0 = max(0.0, a.segment_start or 0.0)
            s1 = min(len(x) / sr, a.segment_end or len(x) / sr)
            x = x[int(s0 * sr) : int(s1 * sr)]
            offset, scope_end = s0, s1
        result = pipeline.run(
            x,
            sr,
            media=rec.media_info or {},
            size_bytes=rec.size_bytes,
            uploaded_at=rec.created_at,
            offset=offset,
            scope_end=scope_end,
            whole_file=whole,
            progress=prog,
            cancel_check=prog.check_cancel,
            run_synthetic=bool(a.options.get("run_synthetic", True)),
        )
        result["file"] = file_summary(rec)
        db.refresh(a)
        a.result = result
        a.verdict = result["overall"]["status"]
        a.status = "succeeded"
        a.stage = "Complete"
        a.progress = 1.0
        a.finished_at = utcnow()
        audit.record(
            db,
            a.owner_id,
            "analysis.completed",
            "analysis",
            a.id,
            {"verdict": a.verdict, "pipeline_version": result["pipeline_version"], "findings": len(result["findings"])},
        )
        db.commit()
        owner = db.get(User, a.owner_id)
        if owner and owner.delete_audio_after_analysis:
            recordings.purge_audio(db, rec, "deleted after analysis (user setting)")
    except AnalysisCancelled:
        db.rollback()
        a = db.get(Analysis, analysis_id)
        a.status = "cancelled"
        a.stage = "Cancelled"
        a.finished_at = utcnow()
        db.commit()
    except media.MediaError as exc:
        db.rollback()
        a = db.get(Analysis, analysis_id)
        a.status = "failed"
        a.error = str(exc)
        a.finished_at = utcnow()
        db.commit()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def mark_failed(db: Session, analysis_id: str, error: str) -> None:
    a = db.get(Analysis, analysis_id)
    if a and a.status not in ("succeeded", "cancelled"):
        a.status = "failed"
        a.error = error[:2000]
        a.finished_at = utcnow()
        db.commit()


def file_summary(rec: Recording) -> dict:
    return {
        "recording_id": rec.id,
        "title": rec.title,
        "filename": rec.original_filename,
        "source": rec.source,
        "sha256": rec.sha256,
        "size_bytes": rec.size_bytes,
        "format": rec.detected_format,
        "codec": rec.codec,
        "duration_seconds": rec.duration_seconds,
        "sample_rate": rec.sample_rate,
        "channels": rec.channels,
        "bit_rate": rec.bit_rate,
        "uploaded_at": rec.created_at.isoformat() if rec.created_at else None,
    }
