"""Retention: audio is deleted automatically when its retention period ends."""

from __future__ import annotations

import logging
import shutil
import time
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..jobs import queue
from ..models import Recording, utcnow
from . import recordings

log = logging.getLogger(__name__)


def purge_expired(db: Session) -> int:
    now = utcnow()
    expired = db.scalars(
        select(Recording).where(
            Recording.audio_expires_at.is_not(None),
            Recording.audio_expires_at < now,
            Recording.audio_purged_at.is_(None),
        )
    ).all()
    for rec in expired:
        recordings.purge_audio(db, rec, "retention period ended")
    purged_tmp = _clean_temp()
    if expired or purged_tmp:
        log.info("retention: purged audio of %d recordings, %d stale temp dirs", len(expired), purged_tmp)
    return len(expired)


def _clean_temp(max_age_s: int = 6 * 3600) -> int:
    """Remove processing directories left behind by crashed workers."""
    root = get_settings().temp_dir
    if not root.exists():
        return 0
    n = 0
    cutoff = time.time() - max_age_s
    for p in root.iterdir():
        try:
            if p.is_dir() and p.stat().st_mtime < cutoff:
                shutil.rmtree(p, ignore_errors=True)
                n += 1
        except FileNotFoundError:
            continue
    return n


def schedule_next(db: Session) -> None:
    queue.enqueue(
        db,
        "retention",
        {},
        run_after=utcnow() + timedelta(seconds=get_settings().purge_interval_seconds),
        dedupe_key="retention-sweep",
        max_attempts=1,
    )
