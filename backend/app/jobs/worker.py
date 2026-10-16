"""Background worker: ``python -m app.jobs.worker``.

Claims jobs from the database queue and runs them one at a time. A heartbeat
thread keeps the claimed job's lock fresh and publishes the worker's detector
status (which models it can actually run) for the system status page.
"""

from __future__ import annotations

import logging
import os
import signal
import socket
import threading
import time
import traceback
import uuid

from sqlalchemy import delete
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import get_sessionmaker
from ..models import Job, WorkerHeartbeat, utcnow
from . import queue

log = logging.getLogger("audio_sentinel.worker")


def _handlers():
    from ..services import analyses, comparisons, recordings, retention

    def ingest(db: Session, payload: dict) -> None:
        recordings.process_ingest(db, payload["recording_id"])

    def analysis(db: Session, payload: dict) -> None:
        analyses.run_job(db, payload["analysis_id"])

    def comparison(db: Session, payload: dict) -> None:
        comparisons.run_job(db, payload["comparison_id"])

    def retention_sweep(db: Session, payload: dict) -> None:
        retention.purge_expired(db)

    return {"ingest": ingest, "analysis": analysis, "comparison": comparison, "retention": retention_sweep}


def _on_final_failure(db: Session, job: Job) -> None:
    from ..models import Recording
    from ..services import analyses, comparisons

    first = (job.last_error or "").splitlines()[0] if job.last_error else ""
    msg = "Processing failed after retries. " + first[:300]
    if job.kind == "analysis":
        analyses.mark_failed(db, job.payload["analysis_id"], msg)
    elif job.kind == "comparison":
        comparisons.mark_failed(db, job.payload["comparison_id"], msg)
    elif job.kind == "ingest":
        rec = db.get(Recording, job.payload["recording_id"])
        if rec and rec.status == "processing":
            rec.status = "failed"
            rec.error = "The audio could not be processed."
            db.commit()


def detector_status() -> dict:
    from ..analysis.synthetic import enabled_detectors, registry

    enabled = {d.info.id for d in enabled_detectors()}
    return {"synthetic": [{**d.status(), "enabled": d.info.id in enabled} for d in registry().values()]}


class Worker:
    def __init__(self, worker_id: str | None = None, kinds: list[str] | None = None):
        self.id = worker_id or f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self.kinds = kinds
        self.stop = threading.Event()
        self.current_job: int | None = None
        self.handlers = _handlers()
        self.sm = get_sessionmaker()

    def _beat(self) -> None:
        status = detector_status()
        last_status = time.monotonic()
        while not self.stop.wait(15):
            try:
                if time.monotonic() - last_status > 300:
                    status = detector_status()
                    last_status = time.monotonic()
                with self.sm() as db:
                    hb = db.get(WorkerHeartbeat, self.id)
                    if hb is None:
                        hb = WorkerHeartbeat(worker_id=self.id, hostname=socket.gethostname())
                        db.add(hb)
                    hb.last_seen_at = utcnow()
                    hb.current_job_id = self.current_job
                    hb.detectors = status
                    db.commit()
                    if self.current_job is not None:
                        queue.heartbeat(db, self.current_job)
            except Exception:  # pragma: no cover - keep heartbeating
                log.exception("heartbeat failed")

    def register(self) -> None:
        with self.sm() as db:
            db.merge(
                WorkerHeartbeat(
                    worker_id=self.id,
                    hostname=socket.gethostname(),
                    started_at=utcnow(),
                    last_seen_at=utcnow(),
                    detectors=detector_status(),
                )
            )
            db.commit()
            queue.requeue_stale(db)
            from ..services import retention

            retention.schedule_next(db)

    def unregister(self) -> None:
        with self.sm() as db:
            db.execute(delete(WorkerHeartbeat).where(WorkerHeartbeat.worker_id == self.id))
            db.commit()

    def run_once(self) -> bool:
        with self.sm() as db:
            job = queue.claim(db, self.id, self.kinds)
            if job is None:
                return False
            self.current_job = job.id
            handler = self.handlers.get(job.kind)
            log.info("job %s (%s) attempt %d", job.id, job.kind, job.attempts)
            try:
                if handler is None:
                    raise RuntimeError(f"no handler for job kind {job.kind!r}")
                handler(db, job.payload)
                db.rollback()  # discard any uncommitted state from the handler
                job = db.get(Job, job.id)
                queue.complete(db, job)
            except queue.Defer as d:
                db.rollback()
                job = db.get(Job, job.id)
                queue.defer(db, job, d.seconds, str(d))
                if job.status == "failed":
                    _on_final_failure(db, job)
            except Exception as exc:
                db.rollback()
                job = db.get(Job, job.id)
                log.error("job %s failed: %s", job.id, exc)
                queue.fail(db, job, f"{type(exc).__name__}: {exc}\n{traceback.format_exc(limit=5)}")
                if job.status == "failed":
                    _on_final_failure(db, job)
            finally:
                self.current_job = None
                if job is not None and job.kind == "retention":
                    from ..services import retention

                    retention.schedule_next(db)
            return True

    def run(self) -> None:
        self.register()
        beat = threading.Thread(target=self._beat, name="heartbeat", daemon=True)
        beat.start()
        poll = get_settings().worker_poll_seconds
        last_stale_check = time.monotonic()
        log.info("worker %s started", self.id)
        try:
            while not self.stop.is_set():
                try:
                    worked = self.run_once()
                except Exception:
                    log.exception("worker loop error")
                    worked = False
                if time.monotonic() - last_stale_check > 60:
                    with self.sm() as db:
                        queue.requeue_stale(db)
                    last_stale_check = time.monotonic()
                if not worked:
                    self.stop.wait(poll)
        finally:
            self.unregister()
            log.info("worker %s stopped", self.id)


def start_embedded() -> Worker:
    """Run a worker thread inside the API process (development convenience)."""
    w = Worker(worker_id=f"embedded-{os.getpid()}")
    t = threading.Thread(target=w.run, name="embedded-worker", daemon=True)
    t.start()
    return w


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    from ..analysis.synthetic import configure_torch

    configure_torch()
    w = Worker()

    def _stop(*_):
        log.info("shutdown requested; finishing current job")
        w.stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    w.run()


if __name__ == "__main__":
    main()
