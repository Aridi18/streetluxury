from __future__ import annotations

import json
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Analysis, AuditEvent, Comparison, Recording, User
from ..reports.pdf import build_analysis_report, build_comparison_report
from ..schemas import AnalysisOut, ComparisonCreate, ComparisonOut
from ..security import current_user
from ..services import audit
from ..services import comparisons as comparison_service
from ..storage import get_store
from .deps import owned_analysis, owned_comparison, owned_recording

router = APIRouter(prefix="/api", tags=["analyses"])


def _rec_brief(rec: Recording | None) -> dict | None:
    if rec is None:
        return None
    return {
        "id": rec.id,
        "title": rec.title,
        "original_filename": rec.original_filename,
        "duration_seconds": rec.duration_seconds,
        "source": rec.source,
        "has_audio": rec.audio_purged_at is None and bool(rec.assets.get("original")),
    }


def analysis_out(a: Analysis, with_result: bool) -> AnalysisOut:
    out = AnalysisOut.model_validate(a)
    if not with_result:
        out.result = None
    out.recording_info = _rec_brief(a.recording)
    return out


@router.get("/analyses")
def list_analyses(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    status: str | None = Query(None, pattern="^(queued|running|succeeded|failed|cancelled)$"),
    verdict: str | None = Query(None, pattern="^(none|possible|strong|inconclusive)$"),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = select(Analysis).where(Analysis.owner_id == user.id)
    if status:
        q = q.where(Analysis.status == status)
    if verdict:
        q = q.where(Analysis.verdict == verdict)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(Analysis.created_at.desc()).limit(limit).offset(offset)).all()
    items = []
    for a in rows:
        d = analysis_out(a, False).model_dump()
        if a.result:
            d["findings_count"] = len(a.result.get("findings", []))
            d["components"] = a.result.get("overall", {}).get("components")
        items.append(d)
    return {"items": items, "total": total}


@router.get("/analyses/{analysis_id}", response_model=AnalysisOut)
def get_analysis(analysis_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return analysis_out(owned_analysis(db, analysis_id, user), True)


@router.post("/analyses/{analysis_id}/cancel", response_model=AnalysisOut)
def cancel_analysis(analysis_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = owned_analysis(db, analysis_id, user)
    if a.status in ("queued", "running"):
        a.cancel_requested = True
        if a.status == "queued":
            a.status = "cancelled"
            a.stage = "Cancelled"
        db.commit()
    return analysis_out(a, False)


@router.delete("/analyses/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = owned_analysis(db, analysis_id, user)
    if a.status == "running":
        a.cancel_requested = True
    audit.record(db, user.id, "analysis.deleted", "analysis", a.id, {"recording_id": a.recording_id})
    db.delete(a)
    db.commit()
    return Response(status_code=204)


def _custody(db: Session, user: User, ids: list[str]) -> list[dict]:
    rows = db.scalars(
        select(AuditEvent)
        .where(AuditEvent.owner_id == user.id, AuditEvent.object_id.in_(ids))
        .order_by(AuditEvent.created_at)
        .limit(200)
    ).all()
    return [
        {
            "at": e.created_at.strftime("%Y-%m-%d %H:%M:%S"),
            "action": e.action,
            "details": ", ".join(f"{k}={v}" for k, v in (e.details or {}).items())[:300],
        }
        for e in rows
    ]


@router.get("/analyses/{analysis_id}/report.pdf")
async def analysis_report(analysis_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    a = owned_analysis(db, analysis_id, user)
    if a.status != "succeeded" or not a.result:
        raise HTTPException(409, "The analysis has not completed successfully, so no report is available.")
    rec = a.recording
    peaks = None
    if rec and rec.assets.get("peaks"):
        try:
            peaks = json.loads(get_store().get_bytes(rec.assets["peaks"]))["peaks"]
        except Exception:
            peaks = None
    audit.record(db, user.id, "report.generated", "analysis", a.id, {"format": "pdf"}, commit=True)
    events = _custody(db, user, [a.id, a.recording_id])
    pdf = await run_in_threadpool(
        build_analysis_report,
        a.result,
        analysis_id=a.id,
        recording_title=rec.title if rec else None,
        audit_events=events,
        peaks=peaks,
    )
    name = f"audio-sentinel-report-{a.id[:8]}.pdf"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


# --- Comparisons -------------------------------------------------------------------


def comparison_out(c: Comparison, with_result: bool) -> ComparisonOut:
    out = ComparisonOut.model_validate(c)
    if not with_result:
        out.result = None
    out.original_info = _rec_brief(c.original)
    out.suspect_info = _rec_brief(c.suspect)
    return out


@router.post("/comparisons", response_model=ComparisonOut, status_code=201)
def create_comparison(body: ComparisonCreate, user: User = Depends(current_user), db: Session = Depends(get_db)):
    if body.original_id == body.suspect_id:
        raise HTTPException(422, "Choose two different recordings.")
    a = owned_recording(db, body.original_id, user)
    b = owned_recording(db, body.suspect_id, user)
    for r in (a, b):
        if r.status == "failed":
            raise HTTPException(422, f"'{r.original_filename}' could not be processed.")
        if r.audio_purged_at or not r.assets.get("original"):
            raise HTTPException(410, f"The audio for '{r.original_filename}' has been deleted.")
    return comparison_out(comparison_service.create(db, user, a, b), False)


@router.get("/comparisons")
def list_comparisons(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    q = select(Comparison).where(Comparison.owner_id == user.id)
    total = db.scalar(select(func.count()).select_from(q.subquery()))
    rows = db.scalars(q.order_by(Comparison.created_at.desc()).limit(limit).offset(offset)).all()
    items = []
    for c in rows:
        d = comparison_out(c, False).model_dump()
        if c.result:
            d["summary"] = c.result.get("summary")
        items.append(d)
    return {"items": items, "total": total}


@router.get("/comparisons/{comparison_id}", response_model=ComparisonOut)
def get_comparison(comparison_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return comparison_out(owned_comparison(db, comparison_id, user), True)


@router.delete("/comparisons/{comparison_id}", status_code=204)
def delete_comparison(comparison_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_comparison(db, comparison_id, user)
    audit.record(db, user.id, "comparison.deleted", "comparison", c.id)
    db.delete(c)
    db.commit()
    return Response(status_code=204)


@router.get("/comparisons/{comparison_id}/report.pdf")
async def comparison_report(comparison_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    c = owned_comparison(db, comparison_id, user)
    if c.status != "succeeded" or not c.result:
        raise HTTPException(409, "The comparison has not completed successfully.")
    audit.record(db, user.id, "report.generated", "comparison", c.id, {"format": "pdf"}, commit=True)
    pdf = await run_in_threadpool(build_comparison_report, c.result, comparison_id=c.id)
    name = f"audio-sentinel-comparison-{c.id[:8]}.pdf"
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(name)}"},
    )


@router.get("/dashboard")
def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)):
    def count(model, *conds):
        return db.scalar(select(func.count()).select_from(model).where(model.owner_id == user.id, *conds)) or 0

    verdicts = dict(
        db.execute(
            select(Analysis.verdict, func.count())
            .where(Analysis.owner_id == user.id, Analysis.status == "succeeded")
            .group_by(Analysis.verdict)
        ).all()
    )
    recent = db.scalars(
        select(Analysis).where(Analysis.owner_id == user.id).order_by(Analysis.created_at.desc()).limit(6)
    ).all()
    active = count(Analysis, or_(Analysis.status == "queued", Analysis.status == "running"))
    return {
        "recordings": count(Recording),
        "analyses": count(Analysis),
        "comparisons": count(Comparison),
        "active_jobs": active,
        "verdicts": {k or "unknown": v for k, v in verdicts.items()},
        "recent": [
            {**analysis_out(a, False).model_dump(), "findings_count": len((a.result or {}).get("findings", []))}
            for a in recent
        ],
    }
