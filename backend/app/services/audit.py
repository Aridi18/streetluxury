from __future__ import annotations

from sqlalchemy.orm import Session

from ..models import AuditEvent


def record(
    db: Session,
    owner_id: str,
    action: str,
    object_type: str,
    object_id: str,
    details: dict | None = None,
    *,
    commit: bool = False,
) -> None:
    """Append a chain-of-custody event. Details must not contain audio content."""
    db.add(
        AuditEvent(
            owner_id=owner_id,
            action=action,
            object_type=object_type,
            object_id=object_id,
            details=details or {},
        )
    )
    if commit:
        db.commit()
