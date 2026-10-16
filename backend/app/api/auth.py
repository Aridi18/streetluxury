from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import ratelimit
from ..config import get_settings
from ..db import get_db
from ..models import Recording, User, utcnow
from ..schemas import LoginIn, PasswordConfirm, RegisterIn, SettingsIn, UserOut
from ..security import (
    clear_session_cookie,
    create_session,
    current_user,
    hash_password,
    revoke_session,
    set_session_cookie,
    validate_password_strength,
    verify_password,
    verify_password_or_dummy,
)
from ..services import audit
from ..services.recordings import delete_recording
from ..storage import get_store

router = APIRouter(prefix="/api", tags=["account"])

login_limit = ratelimit.ip_limit("login", lambda: get_settings().login_rate_per_minute, 60)


@router.post("/auth/register", response_model=UserOut, status_code=201, dependencies=[Depends(login_limit)])
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    settings = get_settings()
    if not settings.allow_registration:
        raise HTTPException(403, "Registration is disabled on this server.")
    validate_password_strength(body.password, body.email)
    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        display_name=(body.display_name or "").strip() or None,
        retention_days=settings.default_retention_days,
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(400, "Registration failed. If you already have an account, sign in.") from exc
    audit.record(db, user.id, "account.created", "user", user.id, commit=True)
    token = create_session(db, user, request.headers.get("user-agent"))
    set_session_cookie(response, token)
    return user


@router.post("/auth/login", response_model=UserOut, dependencies=[Depends(login_limit)])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    ratelimit.check(f"login-email:{email}", get_settings().login_rate_per_minute, 300)
    user = db.scalar(select(User).where(User.email == email))
    if not verify_password_or_dummy(user, body.password) or not user.is_active:
        raise HTTPException(401, "Incorrect email or password.")
    token = create_session(db, user, request.headers.get("user-agent"))
    set_session_cookie(response, token)
    audit.record(db, user.id, "account.signed_in", "user", user.id, commit=True)
    return user


@router.post("/auth/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    revoke_session(db, request.cookies.get(get_settings().session_cookie_name))
    clear_session_cookie(response)
    response.status_code = 204
    return response


@router.get("/auth/me", response_model=UserOut)
def me(user: User = Depends(current_user)):
    return user


@router.get("/settings", response_model=UserOut)
def get_user_settings(user: User = Depends(current_user)):
    return user


@router.put("/settings", response_model=UserOut)
def update_settings(body: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)):
    settings = get_settings()
    changes: dict = {}
    if body.retention_days is not None:
        days = min(body.retention_days, settings.max_retention_days)
        if days != user.retention_days:
            changes["retention_days"] = [user.retention_days, days]
            user.retention_days = days
            # Apply to existing recordings: shorten (never extend beyond the new limit).
            for rec in db.scalars(
                select(Recording).where(Recording.owner_id == user.id, Recording.audio_purged_at.is_(None))
            ):
                new_exp = rec.created_at + timedelta(days=days)
                rec.audio_expires_at = new_exp
    if body.delete_audio_after_analysis is not None:
        changes["delete_audio_after_analysis"] = body.delete_audio_after_analysis
        user.delete_audio_after_analysis = body.delete_audio_after_analysis
    if body.research_consent is not None and body.research_consent != user.research_consent:
        changes["research_consent"] = body.research_consent
        user.research_consent = body.research_consent
        user.research_consent_at = utcnow() if body.research_consent else None
    if body.display_name is not None:
        user.display_name = body.display_name.strip() or None
    if changes:
        audit.record(db, user.id, "settings.updated", "user", user.id, changes)
    db.commit()
    return user


@router.post("/account/delete-data", status_code=200)
def delete_all_data(body: PasswordConfirm, user: User = Depends(current_user), db: Session = Depends(get_db)):
    """Delete every recording, analysis, comparison and report of this account (keeps the account)."""
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(403, "Password is incorrect.")
    recs = db.scalars(select(Recording).where(Recording.owner_id == user.id)).all()
    for rec in recs:
        delete_recording(db, rec, actor_id=user.id)
    get_store().delete_prefix(f"users/{user.id}")
    audit.record(db, user.id, "account.data_deleted", "user", user.id, {"recordings": len(recs)}, commit=True)
    return {"deleted_recordings": len(recs)}


@router.post("/account/delete", status_code=204)
def delete_account(
    body: PasswordConfirm,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    """Delete the account and everything belonging to it, including the audit log."""
    if not verify_password(user.password_hash, body.password):
        raise HTTPException(403, "Password is incorrect.")
    for rec in db.scalars(select(Recording).where(Recording.owner_id == user.id)).all():
        get_store().delete_prefix(f"recordings/{rec.id}")
    db.delete(user)
    db.commit()
    clear_session_cookie(response)
    response.status_code = 204
    return response
