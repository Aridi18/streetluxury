"""Authentication, sessions and request hardening."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .config import get_settings
from .db import get_db
from .models import User, UserSession, utcnow

_hasher = PasswordHasher()  # argon2id with library-recommended parameters

CSRF_HEADER = "x-requested-with"
CSRF_VALUE = "AudioSentinel"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
MIN_PASSWORD_LENGTH = 10


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


# A valid hash used to equalise timing when the account does not exist.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def verify_password_or_dummy(user: User | None, password: str) -> bool:
    if user is None:
        verify_password(_DUMMY_HASH, password)
        return False
    return verify_password(user.password_hash, password)


def validate_password_strength(password: str, email: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Password must be at least {MIN_PASSWORD_LENGTH} characters.")
    if len(password) > 256:
        raise HTTPException(400, "Password is too long.")
    if password.lower() == email.lower() or password.lower() in email.lower():
        raise HTTPException(400, "Password must not contain your email address.")
    if len(set(password)) < 5:
        raise HTTPException(400, "Password is too repetitive.")


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(db: Session, user: User, user_agent: str | None) -> str:
    settings = get_settings()
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            user_id=user.id,
            token_hash=_token_hash(token),
            expires_at=utcnow() + timedelta(hours=settings.session_ttl_hours),
            user_agent=(user_agent or "")[:200] or None,
        )
    )
    # Opportunistically drop this user's expired sessions.
    db.execute(delete(UserSession).where(UserSession.user_id == user.id, UserSession.expires_at < utcnow()))
    db.commit()
    return token


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_hours * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="strict",
        path="/api",
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        settings.session_cookie_name,
        path="/api",
        secure=settings.cookie_secure,
        httponly=True,
        samesite="strict",
    )


def revoke_session(db: Session, token: str | None) -> None:
    if token:
        db.execute(delete(UserSession).where(UserSession.token_hash == _token_hash(token)))
        db.commit()


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in.")
    sess = db.scalar(select(UserSession).where(UserSession.token_hash == _token_hash(token)))
    now = utcnow()
    if sess is None or _as_aware(sess.expires_at) < now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired. Please sign in again.")
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account unavailable.")
    if (now - _as_aware(sess.last_seen_at)).total_seconds() > 300:
        sess.last_seen_at = now
        db.commit()
    request.state.user_id = user.id
    return user


class CSRFMiddleware(BaseHTTPMiddleware):
    """Reject cross-site state-changing requests.

    Session cookies are SameSite=Strict. In addition every unsafe request must
    carry a custom header (which cross-origin pages cannot send without a CORS
    preflight that we do not grant) and, when present, a same-site Origin.
    """

    async def dispatch(self, request: Request, call_next):
        if request.method in UNSAFE_METHODS and request.url.path.startswith("/api/"):
            if request.headers.get(CSRF_HEADER) != CSRF_VALUE:
                return JSONResponse({"detail": "Missing CSRF header."}, status_code=403)
            origin = request.headers.get("origin")
            if origin and not _origin_allowed(request, origin):
                return JSONResponse({"detail": "Cross-origin request rejected."}, status_code=403)
        return await call_next(request)


def _origin_allowed(request: Request, origin: str) -> bool:
    settings = get_settings()
    if origin in settings.allowed_origins:
        return True
    host = request.headers.get("x-forwarded-host") if settings.trust_proxy_headers else None
    host = host or request.headers.get("host", "")
    return origin.split("://", 1)[-1] == host


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Cross-Origin-Opener-Policy", "same-origin")
        h.setdefault("Cross-Origin-Resource-Policy", "same-origin")
        h.setdefault("Permissions-Policy", "microphone=(self), camera=(), geolocation=()")
        if request.url.path.startswith("/api/"):
            h.setdefault("Cache-Control", "no-store")
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        else:
            h.setdefault(
                "Content-Security-Policy",
                "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
                "style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; "
                "connect-src 'self'; font-src 'self' data:; object-src 'none'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            )
        if get_settings().cookie_secure:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response


def client_ip(request: Request) -> str:
    if get_settings().trust_proxy_headers:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
