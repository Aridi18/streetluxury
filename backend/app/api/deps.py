from __future__ import annotations

import uuid

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ..models import Analysis, Comparison, Recording, User


def _uuid_or_404(value: str) -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise HTTPException(404, "Not found.") from exc


def owned(db: Session, model, obj_id: str, user: User):
    """Fetch an object owned by ``user``; 404 (not 403) to avoid leaking existence."""
    obj = db.get(model, _uuid_or_404(obj_id))
    if obj is None or obj.owner_id != user.id:
        raise HTTPException(404, "Not found.")
    return obj


def owned_recording(db: Session, rec_id: str, user: User) -> Recording:
    return owned(db, Recording, rec_id, user)


def owned_analysis(db: Session, analysis_id: str, user: User) -> Analysis:
    return owned(db, Analysis, analysis_id, user)


def owned_comparison(db: Session, comparison_id: str, user: User) -> Comparison:
    return owned(db, Comparison, comparison_id, user)
