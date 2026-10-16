from __future__ import annotations

import hashlib
import os
import re
import shutil
from urllib.parse import quote, unquote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import media, ratelimit
from ..config import get_settings
from ..db import get_db, get_sessionmaker
from ..models import Analysis, Recording, User
from ..schemas import AnalysisCreate, AnalysisOut, AnalysisSummary, RecordingOut, RecordingPatch
from ..security import current_user
from ..services import analyses as analysis_service
from ..services import audit
from ..services.recordings import UploadRejected, delete_recording, receive_upload
from ..storage import get_store, secure_tempdir
from .deps import owned_recording

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

upload_limit = ratelimit.user_limit("upload", lambda: get_settings().upload_rate_per_hour, 3600)
analysis_limit = ratelimit.user_limit("analysis", lambda: get_settings().analysis_rate_per_hour, 3600)


def recording_out(db: Session, rec: Recording, detail: bool = False) -> RecordingOut:
    latest = db.scalar(
        select(Analysis).where(Analysis.recording_id == rec.id).order_by(Analysis.created_at.desc()).limit(1)
    )
    out = RecordingOut.model_validate(rec)
    out.has_audio = bool(rec.assets.get("original")) and rec.audio_purged_at is None
    out.playback_transcoded = bool(rec.assets.get("playback"))
    out.spectrogram = rec.assets.get("spectrogram")
    out.media_info = rec.media_info if detail else None
    out.latest_analysis = AnalysisSummary.model_validate(latest) if latest else None
    return out


@router.post("", response_model=RecordingOut, status_code=201, dependencies=[Depends(upload_limit)])
async def upload(
    request: Request,
    source: str = Query("upload", pattern="^(upload|microphone|voice_note)$"),
    title: str | None = Query(None, max_length=200),
    user: User = Depends(current_user),
):
    """Upload raw audio bytes as the request body (``Content-Type`` audio/* or octet-stream).

    The original filename is passed URL-encoded in ``X-Filename``.
    """
    settings = get_settings()
    limit = settings.max_upload_bytes
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        raise HTTPException(413, f"File is larger than the {settings.max_upload_mb} MB limit.")
    filename = unquote(request.headers.get("x-filename", "recording"))[:255]
    tmp = await run_in_threadpool(secure_tempdir, "upload-")
    path = tmp / "upload.bin"
    h = hashlib.sha256()
    size = 0
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as fh:
            async for chunk in request.stream():
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"File is larger than the {settings.max_upload_mb} MB limit.")
                h.update(chunk)
                fh.write(chunk)

        def _store() -> Recording:
            with get_sessionmaker()() as db:
                u = db.get(User, user.id)
                rec = receive_upload(
                    path,
                    user=u,
                    db=db,
                    filename=filename,
                    source=source,
                    title=title,
                    declared_type=request.headers.get("content-type"),
                    sha256=h.hexdigest(),
                    size=size,
                )
                return recording_out(db, rec)

        try:
            return await run_in_threadpool(_store)
        except UploadRejected as exc:
            raise HTTPException(exc.status, str(exc)) from exc
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


@router.get("")
def list_recordings(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None, max_length=100),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    base = select(Recording).where(Recording.owner_id == user.id)
    if q:
        like = f"%{q.lower()}%"
        base = base.where(func.lower(Recording.original_filename).like(like) | func.lower(Recording.title).like(like))
    total = db.scalar(select(func.count()).select_from(base.subquery()))
    rows = db.scalars(base.order_by(Recording.created_at.desc()).limit(limit).offset(offset)).all()
    return {"items": [recording_out(db, r) for r in rows], "total": total}


@router.get("/{rec_id}", response_model=RecordingOut)
def get_recording(rec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return recording_out(db, owned_recording(db, rec_id, user), detail=True)


@router.patch("/{rec_id}", response_model=RecordingOut)
def patch_recording(
    rec_id: str, body: RecordingPatch, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    rec = owned_recording(db, rec_id, user)
    if body.title is not None:
        rec.title = body.title.strip() or None
    db.commit()
    return recording_out(db, rec, detail=True)


@router.delete("/{rec_id}", status_code=204)
def remove_recording(rec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = owned_recording(db, rec_id, user)
    delete_recording(db, rec, actor_id=user.id)
    return Response(status_code=204)


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


@router.get("/{rec_id}/audio")
def stream_audio(
    rec_id: str,
    request: Request,
    variant: str = Query("auto", pattern="^(auto|original|playback)$"),
    download: bool = False,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    rec = owned_recording(db, rec_id, user)
    if rec.audio_purged_at or not rec.assets.get("original"):
        raise HTTPException(410, "The audio for this recording has been deleted.")
    key = rec.assets["original"]
    mime = (
        media.FORMATS[rec.detected_format].mime if rec.detected_format in media.FORMATS else "application/octet-stream"
    )
    if download:
        variant = "original"
    if variant in ("auto", "playback") and rec.assets.get("playback"):
        key, mime = rec.assets["playback"], "audio/flac"
    elif variant == "playback":
        raise HTTPException(404, "No playback copy exists; the original is browser-playable.")
    store = get_store()
    size = store.size(key)
    headers = {"Accept-Ranges": "bytes", "Cache-Control": "private, no-store"}
    if download:
        audit.record(db, user.id, "recording.downloaded", "recording", rec.id, {"sha256": rec.sha256}, commit=True)
        headers["Content-Disposition"] = f"attachment; filename*=UTF-8''{quote(rec.original_filename)}"
    else:
        headers["Content-Disposition"] = "inline"
    rng = request.headers.get("range")
    start, end = 0, size
    status = 200
    if rng:
        m = _RANGE.match(rng.strip())
        if not m or (not m.group(1) and not m.group(2)):
            raise HTTPException(416, "Invalid range.", headers={"Content-Range": f"bytes */{size}"})
        if m.group(1):
            start = int(m.group(1))
            end = int(m.group(2)) + 1 if m.group(2) else size
        else:
            start = max(0, size - int(m.group(2)))
        end = min(end, size)
        if start >= size or start >= end:
            raise HTTPException(416, "Range not satisfiable.", headers={"Content-Range": f"bytes */{size}"})
        status = 206
        headers["Content-Range"] = f"bytes {start}-{end - 1}/{size}"
    headers["Content-Length"] = str(end - start)
    return StreamingResponse(store.iter_range(key, start, end), status_code=status, media_type=mime, headers=headers)


@router.get("/{rec_id}/peaks")
def get_peaks(rec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = owned_recording(db, rec_id, user)
    key = rec.assets.get("peaks")
    if not key:
        raise HTTPException(404, "Waveform not available.")
    return Response(
        get_store().get_bytes(key), media_type="application/json", headers={"Cache-Control": "private, max-age=3600"}
    )


@router.get("/{rec_id}/spectrogram/{index}.png")
def get_spectrogram_tile(rec_id: str, index: int, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = owned_recording(db, rec_id, user)
    tiles = (rec.assets.get("spectrogram") or {}).get("tiles", [])
    if not any(t["index"] == index for t in tiles):
        raise HTTPException(404, "Spectrogram tile not found.")
    data = get_store().get_bytes(f"recordings/{rec.id}/spectrogram/{index}.png")
    return Response(data, media_type="image/png", headers={"Cache-Control": "private, max-age=3600"})


@router.post("/{rec_id}/analyses", response_model=AnalysisOut, status_code=201, dependencies=[Depends(analysis_limit)])
def create_analysis(
    rec_id: str, body: AnalysisCreate, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    rec = owned_recording(db, rec_id, user)
    if rec.status == "failed":
        raise HTTPException(422, rec.error or "This recording could not be processed.")
    if rec.audio_purged_at or not rec.assets.get("original"):
        raise HTTPException(410, "The audio for this recording has been deleted.")
    start, end = body.start, body.end
    dur = rec.duration_seconds or 0
    if start is not None or end is not None:
        start = start or 0.0
        end = end if end is not None else dur
        if dur and end > dur + 0.05:
            raise HTTPException(422, "The selected segment extends beyond the end of the recording.")
        if end - start < 1.0:
            raise HTTPException(422, "Select at least 1 second of audio to analyse.")
        if dur and start <= 0.01 and end >= dur - 0.05:
            start = end = None  # the selection is the whole file
    a = analysis_service.create(db, user, rec, start=start, end=end, run_synthetic=body.run_synthetic)
    return AnalysisOut.model_validate(a)


@router.get("/{rec_id}/analyses")
def recording_analyses(rec_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    rec = owned_recording(db, rec_id, user)
    rows = db.scalars(
        select(Analysis).where(Analysis.recording_id == rec.id).order_by(Analysis.created_at.desc())
    ).all()
    return {"items": [AnalysisOut.model_validate(a).model_dump(exclude={"result"}) for a in rows], "total": len(rows)}
