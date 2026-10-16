"""FastAPI application: ``uvicorn app.main:app``."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from .analysis.base import PIPELINE_VERSION
from .api import analyses, auth, recordings, system
from .config import get_settings
from .db import Base, get_engine
from .security import CSRFMiddleware, SecurityHeadersMiddleware

log = logging.getLogger("audio_sentinel")
MAX_JSON_BODY = 1024 * 1024


class BodySizeMiddleware(BaseHTTPMiddleware):
    """Bound non-upload request bodies (uploads enforce their own, larger limit)."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH") and not (
            request.url.path == "/api/recordings" and request.method == "POST"
        ):
            cl = request.headers.get("content-length")
            if cl and cl.isdigit() and int(cl) > MAX_JSON_BODY:
                return JSONResponse({"detail": "Request body too large."}, status_code=413)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    problems = settings.validate_for_production()
    if problems:
        raise RuntimeError("Refusing to start: " + "; ".join(problems))
    if settings.env != "production":
        Base.metadata.create_all(get_engine())  # production uses Alembic migrations
    settings.temp_dir.mkdir(parents=True, exist_ok=True)
    worker = None
    if settings.embedded_worker:
        from .jobs.worker import start_embedded

        worker = start_embedded()
        log.info("embedded worker started")
    yield
    if worker is not None:
        worker.stop.set()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Audio Sentinel API",
        version=PIPELINE_VERSION,
        lifespan=lifespan,
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env != "production" else None,
    )
    app.add_middleware(BodySizeMiddleware)
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_credentials=True,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
            allow_headers=["Content-Type", "X-Requested-With", "X-Filename", "Range"],
            expose_headers=["Content-Range", "Content-Length", "Accept-Ranges"],
        )

    @app.exception_handler(RequestValidationError)
    async def _validation(_req: Request, exc: RequestValidationError):
        msgs = []
        for e in exc.errors():
            loc = ".".join(str(p) for p in e.get("loc", []) if p != "body")
            msgs.append(f"{loc}: {e.get('msg')}" if loc else e.get("msg"))
        return JSONResponse({"detail": "; ".join(msgs) or "Invalid request."}, status_code=422)

    @app.exception_handler(Exception)
    async def _unhandled(_req: Request, exc: Exception):
        log.exception("unhandled error", exc_info=exc)
        return JSONResponse({"detail": "An internal error occurred."}, status_code=500)

    app.include_router(auth.router)
    app.include_router(recordings.router)
    app.include_router(analyses.router)
    app.include_router(system.router)

    dist = settings.frontend_dist
    if dist and Path(dist).is_dir() and (Path(dist) / "index.html").exists():
        _mount_spa(app, Path(dist))
    return app


def _mount_spa(app: FastAPI, dist: Path) -> None:
    root = dist.resolve()

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str):
        if path.startswith("api/"):
            raise StarletteHTTPException(404)
        candidate = (root / path).resolve()
        if path and root in candidate.parents and candidate.is_file():
            headers = {"Cache-Control": "public, max-age=31536000, immutable"} if path.startswith("assets/") else {}
            return FileResponse(candidate, headers=headers)
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})


app = create_app()
