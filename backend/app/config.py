"""Runtime configuration.

All settings are read from environment variables (prefix ``AS_``) or a ``.env``
file. Secrets (database password, storage encryption key, S3 credentials) are
only ever read on the server; nothing here is exposed to the frontend.
"""

from __future__ import annotations

import base64
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="AS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    env: Literal["development", "test", "production"] = "development"

    # --- Database -----------------------------------------------------------
    database_url: str = "postgresql+psycopg://sentinel:sentinel@localhost:5432/audio_sentinel"
    db_echo: bool = False

    # --- HTTP / sessions ----------------------------------------------------
    # Origins allowed to make credentialed requests. In the default deployment the
    # SPA is served from the same origin as the API, so this can stay empty.
    allowed_origins: list[str] = Field(default_factory=list)
    session_cookie_name: str = "as_session"
    session_ttl_hours: int = 12
    cookie_secure: bool = True
    allow_registration: bool = True
    trust_proxy_headers: bool = False

    # --- Storage ------------------------------------------------------------
    storage_backend: Literal["local", "s3"] = "local"
    storage_dir: Path = BACKEND_DIR / "var" / "objects"
    temp_dir: Path = BACKEND_DIR / "var" / "tmp"
    # 32-byte key, base64 encoded. Required outside development/test.
    storage_encryption_key: str | None = None
    s3_bucket: str | None = None
    s3_prefix: str = "audio-sentinel/"
    s3_region: str | None = None
    s3_endpoint_url: str | None = None

    # --- Upload limits ------------------------------------------------------
    max_upload_mb: int = 100
    max_duration_seconds: float = 30 * 60
    min_duration_seconds: float = 0.5

    # --- Retention ----------------------------------------------------------
    default_retention_days: int = 30
    max_retention_days: int = 365
    purge_interval_seconds: int = 3600

    # --- Rate limiting ------------------------------------------------------
    redis_url: str | None = None
    rate_limit_enabled: bool = True
    login_rate_per_minute: int = 8
    upload_rate_per_hour: int = 60
    analysis_rate_per_hour: int = 120
    api_rate_per_minute: int = 600

    # --- Job queue ----------------------------------------------------------
    embedded_worker: bool = False
    worker_poll_seconds: float = 1.0
    job_stale_seconds: int = 600
    job_max_attempts: int = 2

    # --- Detection models ---------------------------------------------------
    model_dir: Path = BACKEND_DIR / "models_cache"
    calibration_dir: Path = BACKEND_DIR / "calibration"
    # Comma-separated list of synthetic-speech detectors to enable. Detectors whose
    # weights or dependencies are missing report "not configured" instead of running.
    synthetic_detectors: str = "antideepfake-w2v2-small,aasist"
    antideepfake_repo: str = "nii-yamagishilab/wav2vec-small-anti-deepfake"
    antideepfake_revision: str = "9a13264b5dcc827a8d5a4f8e01fccefa392f886b"
    allow_model_download: bool = False
    torch_threads: int = 0  # 0 = library default

    # --- Frontend -----------------------------------------------------------
    # When set (and the directory exists), the API also serves the built SPA.
    frontend_dist: Path | None = BACKEND_DIR.parent / "frontend" / "dist"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _split_origins(cls, v: object) -> object:
        if isinstance(v, str):
            return [o.strip() for o in v.split(",") if o.strip()]
        return v

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024

    @property
    def enabled_synthetic_detectors(self) -> list[str]:
        return [d.strip() for d in self.synthetic_detectors.split(",") if d.strip()]

    def encryption_key_bytes(self) -> bytes:
        """Return the 32-byte master key for at-rest encryption.

        In development and test a deterministic per-installation key file is
        generated so that local runs work out of the box. Production refuses to
        start without an explicit key.
        """
        if self.storage_encryption_key:
            key = base64.b64decode(self.storage_encryption_key)
            if len(key) != 32:
                raise ValueError("AS_STORAGE_ENCRYPTION_KEY must decode to exactly 32 bytes")
            return key
        if self.env == "production":
            raise RuntimeError("AS_STORAGE_ENCRYPTION_KEY is required in production")
        key_file = self.storage_dir.parent / "dev-encryption.key"
        key_file.parent.mkdir(parents=True, exist_ok=True)
        if not key_file.exists():
            import os

            key_file.write_bytes(os.urandom(32))
            key_file.chmod(0o600)
        return key_file.read_bytes()

    def validate_for_production(self) -> list[str]:
        problems: list[str] = []
        if self.env != "production":
            return problems
        if not self.storage_encryption_key:
            problems.append("AS_STORAGE_ENCRYPTION_KEY is not set")
        if not self.cookie_secure:
            problems.append("AS_COOKIE_SECURE must be true in production")
        if self.database_url.startswith("sqlite"):
            problems.append("SQLite is not supported in production; use PostgreSQL")
        if self.storage_backend == "s3" and not self.s3_bucket:
            problems.append("AS_S3_BUCKET is required for the s3 storage backend")
        return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
