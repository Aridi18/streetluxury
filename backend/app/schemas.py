from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator

_EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,255}\.[^@\s]{2,63}$")


class RegisterIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(min_length=1, max_length=256)
    display_name: str | None = Field(default=None, max_length=120)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if not _EMAIL.match(v):
            raise ValueError("Enter a valid email address.")
        return v


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    email: str
    display_name: str | None
    created_at: datetime
    retention_days: int
    delete_audio_after_analysis: bool
    research_consent: bool
    research_consent_at: datetime | None


class SettingsIn(BaseModel):
    retention_days: int | None = Field(default=None, ge=1, le=365)
    delete_audio_after_analysis: bool | None = None
    research_consent: bool | None = None
    display_name: str | None = Field(default=None, max_length=120)


class PasswordConfirm(BaseModel):
    password: str = Field(max_length=256)


class AnalysisSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    status: str
    verdict: str | None
    created_at: datetime
    segment_start: float | None
    segment_end: float | None


class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    title: str | None
    original_filename: str
    source: str
    detected_format: str | None
    size_bytes: int
    sha256: str
    status: str
    error: str | None
    duration_seconds: float | None
    sample_rate: int | None
    channels: int | None
    codec: str | None
    bit_rate: int | None
    created_at: datetime
    audio_expires_at: datetime | None
    audio_purged_at: datetime | None
    has_audio: bool = False
    playback_transcoded: bool = False
    spectrogram: dict[str, Any] | None = None
    media_info: dict[str, Any] | None = None
    latest_analysis: AnalysisSummary | None = None


class RecordingPatch(BaseModel):
    title: str | None = Field(default=None, max_length=200)


class AnalysisCreate(BaseModel):
    start: float | None = Field(default=None, ge=0)
    end: float | None = Field(default=None, gt=0)
    run_synthetic: bool = True


class AnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    recording_id: str
    status: str
    stage: str | None
    progress: float
    segment_start: float | None
    segment_end: float | None
    verdict: str | None
    error: str | None
    pipeline_version: str | None
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    result: dict[str, Any] | None = None
    recording_info: dict[str, Any] | None = None


class ComparisonCreate(BaseModel):
    original_id: str
    suspect_id: str


class ComparisonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    original_id: str
    suspect_id: str
    status: str
    stage: str | None
    progress: float
    error: str | None
    pipeline_version: str | None
    created_at: datetime
    finished_at: datetime | None
    result: dict[str, Any] | None = None
    original_info: dict[str, Any] | None = None
    suspect_info: dict[str, Any] | None = None


class Page(BaseModel):
    items: list[Any]
    total: int
