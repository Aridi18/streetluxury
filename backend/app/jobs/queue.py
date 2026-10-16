"""A small, transactional job queue stored in the application database.

PostgreSQL workers claim jobs with ``SELECT ... FOR UPDATE SKIP LOCKED`` so any
number of worker processes can run concurrently. SQLite (tests only) falls back
to an optimistic compare-and-set update.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import Job, utcnow


def enqueue(
    db: Session,
    kind: str,
    payload: dict,
    *,
    run_after: datetime | None = None,
    dedupe_key: str | None = None,
    max_attempts: int | None = None,
    commit: bool = True,
) -> Job | None:
    job = Job(
        kind=kind,
        payload=payload,
        run_after=run_after or utcnow(),
        dedupe_key=dedupe_key,
        max_attempts=max_attempts or get_settings().job_max_attempts,
    )
    if dedupe_key is None:
        db.add(job)
        if commit:
            db.commit()
        return job
    # Singleton jobs (e.g. the retention sweep): ignore if one is already pending.
    try:
        with db.begin_nested():
            db.add(job)
        if commit:
            db.commit()
        return job
    except IntegrityError:
        return None


def claim(db: Session, worker_id: str, kinds: list[str] | None = None) -> Job | None:
    now = utcnow()
    q = select(Job).where(Job.status == "queued", Job.run_after <= now)
    if kinds:
        q = q.where(Job.kind.in_(kinds))
    q = q.order_by(Job.run_after, Job.id).limit(1)
    if db.bind.dialect.name == "postgresql":
        job = db.scalar(q.with_for_update(skip_locked=True))
        if job is None:
            db.rollback()
            return None
        job.status = "running"
        job.attempts += 1
        job.locked_by = worker_id
        job.locked_at = job.heartbeat_at = now
        db.commit()
        return job
    job = db.scalar(q)
    if job is None:
        return None
    res = db.execute(
        update(Job)
        .where(Job.id == job.id, Job.status == "queued")
        .values(
            status="running",
            attempts=Job.attempts + 1,
            locked_by=worker_id,
            locked_at=now,
            heartbeat_at=now,
        )
    )
    db.commit()
    if res.rowcount != 1:
        return None
    db.refresh(job)
    return job


def heartbeat(db: Session, job_id: int) -> None:
    db.execute(update(Job).where(Job.id == job_id).values(heartbeat_at=utcnow()))
    db.commit()


class Defer(Exception):  # noqa: N818 - control-flow signal, not an error
    """Raised by a handler whose prerequisites are not ready yet (re-run later, no attempt used)."""

    def __init__(self, seconds: float, reason: str):
        super().__init__(reason)
        self.seconds = seconds


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def defer(db: Session, job: Job, seconds: float, reason: str, max_wait_s: float = 3600) -> None:
    """Put a job back in the queue without using up an attempt (bounded by ``max_wait_s``)."""
    if (utcnow() - _aware(job.created_at)).total_seconds() > max_wait_s:
        fail(db, job, f"Gave up waiting: {reason}", retry=False)
        return
    job.status = "queued"
    job.attempts = max(0, job.attempts - 1)
    job.run_after = utcnow() + timedelta(seconds=seconds)
    job.locked_by = None
    db.commit()


def complete(db: Session, job: Job) -> None:
    job.status = "succeeded"
    job.finished_at = utcnow()
    job.dedupe_key = None
    db.commit()


def fail(db: Session, job: Job, error: str, *, retry: bool = True) -> None:
    job.last_error = error[:4000]
    if retry and job.attempts < job.max_attempts:
        job.status = "queued"
        job.run_after = utcnow() + timedelta(seconds=30 * job.attempts)
        job.locked_by = None
    else:
        job.status = "failed"
        job.finished_at = utcnow()
        job.dedupe_key = None
    db.commit()


def requeue_stale(db: Session) -> int:
    """Return jobs whose worker stopped sending heartbeats to the queue."""
    cutoff = utcnow() - timedelta(seconds=get_settings().job_stale_seconds)
    stale = db.scalars(
        select(Job).where(
            Job.status == "running",
            or_(Job.heartbeat_at.is_(None), Job.heartbeat_at < cutoff),
        )
    ).all()
    for job in stale:
        if job.attempts < job.max_attempts:
            job.status = "queued"
            job.locked_by = None
        else:
            job.status = "failed"
            job.finished_at = utcnow()
            job.dedupe_key = None
            job.last_error = "Worker stopped responding while processing this job."
    db.commit()
    return len(stale)


def queue_stats(db: Session) -> dict:
    from sqlalchemy import func

    rows = db.execute(select(Job.status, func.count()).group_by(Job.status)).all()
    stats = {status: count for status, count in rows}
    oldest = db.scalar(select(func.min(Job.created_at)).where(and_(Job.status == "queued")))
    return {"counts": stats, "oldest_queued_at": oldest.isoformat() if oldest else None}
