"""Recording ingest, derived assets and deletion."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import shutil
import unicodedata
from datetime import timedelta
from pathlib import Path

import numpy as np
from sqlalchemy.orm import Session

from .. import media
from ..analysis import visuals
from ..config import get_settings
from ..jobs import queue
from ..models import Recording, User, utcnow
from ..storage import get_store, secure_tempdir
from . import audit

log = logging.getLogger(__name__)

SOURCES = {"upload", "microphone", "voice_note"}


class UploadRejected(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


def sanitize_filename(name: str | None) -> str:
    name = unicodedata.normalize("NFKC", name or "recording")
    name = name.replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r"[^\w.\- ()\[\]]", "_", name).strip(" .")
    return (name or "recording")[:200]


def original_key(rec_id: str) -> str:
    return f"recordings/{rec_id}/original"


def receive_upload(
    chunks_path: Path,
    *,
    user: User,
    db: Session,
    filename: str | None,
    source: str,
    title: str | None,
    declared_type: str | None,
    sha256: str,
    size: int,
) -> Recording:
    """Validate a fully received upload (plaintext temp file) and store it encrypted.

    The caller streams the request body into ``chunks_path`` while enforcing the
    size limit and computing ``sha256``.
    """
    settings = get_settings()
    if source not in SOURCES:
        raise UploadRejected("Unknown recording source.")
    if size == 0:
        raise UploadRejected("The file is empty.")
    with open(chunks_path, "rb") as fh:
        head = fh.read(64)
    fmt = media.sniff_format(head)
    if fmt is None:
        raise UploadRejected(
            f"Unsupported or unrecognised file type. Supported formats: {media.SUPPORTED_DESCRIPTION}.",
            415,
        )
    try:
        info = media.probe(chunks_path, fmt)
    except media.MediaError as exc:
        raise UploadRejected(str(exc), 422) from exc
    if info.duration and info.duration > settings.max_duration_seconds:
        raise UploadRejected(
            f"The recording is {info.duration / 60:.1f} minutes long; the limit is "
            f"{settings.max_duration_seconds / 60:.0f} minutes. Trim it or analyse it in parts.",
            413,
        )
    if info.duration and info.duration < settings.min_duration_seconds:
        raise UploadRejected("The recording is too short to analyse.", 422)

    rec = Recording(
        owner_id=user.id,
        title=(title or "").strip()[:200] or None,
        original_filename=sanitize_filename(filename),
        source=source,
        detected_format=fmt.name,
        declared_content_type=(declared_type or "")[:100] or None,
        size_bytes=size,
        sha256=sha256,
        status="processing",
        duration_seconds=info.duration or None,
        sample_rate=info.sample_rate,
        channels=info.channels,
        codec=info.codec,
        bit_rate=info.bit_rate,
        media_info=info.to_dict(),
        assets={},
        audio_expires_at=utcnow() + timedelta(days=user.retention_days),
    )
    db.add(rec)
    db.flush()
    key = original_key(rec.id)
    get_store().put_file(key, chunks_path)
    rec.assets = {"original": key}
    audit.record(
        db,
        user.id,
        "recording.uploaded",
        "recording",
        rec.id,
        {"sha256": sha256, "size_bytes": size, "format": fmt.name, "source": source, "filename": rec.original_filename},
    )
    queue.enqueue(db, "ingest", {"recording_id": rec.id}, commit=False)
    db.commit()
    return rec


def process_ingest(db: Session, recording_id: str) -> None:
    """Decode once and build playback copy, peaks and spectrogram tiles."""
    rec = db.get(Recording, recording_id)
    if rec is None or rec.status != "processing":
        return
    store = get_store()
    tmp = secure_tempdir("ingest-")
    try:
        src = tmp / "original"
        store.download_to(rec.assets["original"], src)
        if hashlib.sha256(src.read_bytes()).hexdigest() != rec.sha256:
            raise RuntimeError("stored object does not match the uploaded file hash")
        fmt = media.FORMATS[rec.detected_format]
        info = media.probe(src, fmt)
        sr = media.analysis_sample_rate(info.sample_rate)
        x = media.decode(src, fmt, sr)
        if x.size < sr * get_settings().min_duration_seconds:
            raise media.MediaError("The file decodes to less audio than the minimum duration.")
        if not np.isfinite(x).all():
            x = np.nan_to_num(x)
        duration = len(x) / sr
        assets = dict(rec.assets)
        if not info.browser_playable:
            pb = media.transcode_flac(src, fmt, tmp / "playback.flac")
            key = f"recordings/{rec.id}/playback.flac"
            store.put_file(key, pb)
            assets["playback"] = key
        pk = visuals.peaks(x, sr)
        store.put_bytes(f"recordings/{rec.id}/peaks.json", json.dumps(pk).encode())
        assets["peaks"] = f"recordings/{rec.id}/peaks.json"
        tiles = []
        for t in visuals.spectrogram_tiles(x, sr):
            key = f"recordings/{rec.id}/spectrogram/{t['index']}.png"
            store.put_bytes(key, t["png"])
            tiles.append({"index": t["index"], "start": round(t["start"], 4), "end": round(t["end"], 4)})
        assets["spectrogram"] = {"tiles": tiles, "max_freq_hz": sr / 2}
        rec.assets = assets
        rec.duration_seconds = duration
        rec.status = "ready"
        rec.error = None
        audit.record(
            db,
            rec.owner_id,
            "recording.processed",
            "recording",
            rec.id,
            {"decoded_duration_s": round(duration, 3), "analysis_sample_rate": sr},
        )
        db.commit()
    except media.MediaError as exc:
        rec.status = "failed"
        rec.error = str(exc)
        db.commit()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def delete_recording(db: Session, rec: Recording, *, actor_id: str) -> None:
    get_store().delete_prefix(f"recordings/{rec.id}")
    audit.record(
        db,
        actor_id,
        "recording.deleted",
        "recording",
        rec.id,
        {"sha256": rec.sha256, "filename": rec.original_filename},
    )
    db.delete(rec)
    db.commit()


def purge_audio(db: Session, rec: Recording, reason: str) -> None:
    """Delete audio objects but keep the analysis records (retention / user choice)."""
    get_store().delete_prefix(f"recordings/{rec.id}")
    rec.assets = {}
    rec.audio_purged_at = utcnow()
    audit.record(db, rec.owner_id, "recording.audio_purged", "recording", rec.id, {"reason": reason})
    db.commit()
