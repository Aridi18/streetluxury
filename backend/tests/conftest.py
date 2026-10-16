"""Test configuration: isolated SQLite database, temporary encrypted storage, no ML models.

Set ``AS_TEST_DATABASE_URL`` to run the suite against PostgreSQL instead.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import pytest

_TMP = Path(tempfile.mkdtemp(prefix="as-tests-"))
os.environ.update(
    {
        "AS_ENV": "test",
        "AS_DATABASE_URL": os.environ.get("AS_TEST_DATABASE_URL", f"sqlite:///{_TMP / 'test.db'}"),
        "AS_STORAGE_DIR": str(_TMP / "objects"),
        "AS_TEMP_DIR": str(_TMP / "tmp"),
        "AS_CALIBRATION_DIR": str(_TMP / "calibration"),
        "AS_SYNTHETIC_DETECTORS": "",
        "AS_RATE_LIMIT_ENABLED": "false",
        "AS_COOKIE_SECURE": "false",
        "AS_EMBEDDED_WORKER": "false",
        "AS_FRONTEND_DIST": str(_TMP / "no-frontend"),
        "AS_MAX_UPLOAD_MB": "20",
    }
)

SR = 16000
CSRF = {"X-Requested-With": "AudioSentinel"}


@pytest.fixture(scope="session")
def app():
    from app.db import Base, get_engine
    from app.main import create_app

    Base.metadata.drop_all(get_engine())
    Base.metadata.create_all(get_engine())
    return create_app()


@pytest.fixture()
def client(app):
    from fastapi.testclient import TestClient

    with TestClient(app, base_url="http://testserver") as c:
        yield c


_counter = iter(range(10_000))


@pytest.fixture()
def user_client(client):
    """A client signed in as a fresh user."""
    email = f"user{next(_counter)}@example.com"
    r = client.post("/api/auth/register", json={"email": email, "password": "a long test password"}, headers=CSRF)
    assert r.status_code == 201, r.text
    client.email = email  # type: ignore[attr-defined]
    return client


def run_worker_until_idle(max_jobs: int = 50) -> int:
    from app.jobs.worker import Worker

    w = Worker(worker_id="test-worker")
    n = 0
    while n < max_jobs and w.run_once():
        n += 1
    return n


# --- Synthetic test audio -------------------------------------------------------------


def speech_like(seconds: float, seed: int = 0, f0: float = 140.0, noise_db: float = -55.0) -> np.ndarray:
    """Voiced, syllable-modulated harmonic signal with pauses and a pink-noise floor.

    It is not speech, but it has the properties the detectors rely on: a voice-like
    harmonic spectrum with slowly varying pitch, an energy envelope with pauses, and a
    stationary background.
    """
    rng = np.random.default_rng(seed)
    n = int(seconds * SR)
    # Aperiodic pitch contour (smoothed random walk) and jittered syllable rate, so that
    # the signal never repeats (real speech does not either).
    walk = np.cumsum(rng.standard_normal(n // 160 + 2)) * 0.02
    walk = np.convolve(walk, np.hanning(25) / 12.5, mode="same")
    f = f0 * np.exp(np.interp(np.arange(n), np.arange(walk.size) * 160, walk - walk.mean()))
    phase = 2 * np.pi * np.cumsum(f) / SR
    # Harmonics up to ~7.5 kHz with a natural ~-6 dB/octave roll-off.
    voice = sum((0.6 / k) * np.sin(k * phase) for k in range(1, int(7500 / f0)))
    rate = 4.0 + np.interp(
        np.arange(n),
        np.arange(0, n + 1600, 1600),
        rng.uniform(-1.2, 1.2, n // 1600 + 2)[: len(np.arange(0, n + 1600, 1600))],
    )
    syll = 0.5 * (1 + np.sin(2 * np.pi * np.cumsum(rate) / SR + rng.uniform(0, 6)))
    words = np.zeros(n)
    pos = int(0.3 * SR)
    while pos < n:
        length = int(rng.uniform(0.8, 2.2) * SR)
        words[pos : pos + length] = 1.0
        pos += length + int(rng.uniform(0.35, 0.8) * SR)
    env = np.convolve(words * syll, np.hanning(400) / 200, mode="same")
    x = 0.25 * voice * env
    # Fricative-like high-frequency noise bursts inside words (as in /s/, /f/, /sh/).
    hf = np.diff(np.r_[0.0, rng.standard_normal(n)])
    bursts = np.zeros(n)
    for start in rng.uniform(0, seconds, int(seconds * 1.5)):
        a = int(start * SR)
        bursts[a : a + int(0.08 * SR)] = 1.0
    bursts *= words
    x += 0.03 * hf * np.convolve(bursts, np.hanning(160) / 80, mode="same")
    x += pink_noise(n, noise_db, rng)
    return x.astype(np.float32)


def pink_noise(n: int, level_db: float, rng=None) -> np.ndarray:
    rng = rng or np.random.default_rng(1)
    w = rng.standard_normal(n)
    spec = np.fft.rfft(w)
    spec /= np.sqrt(np.arange(spec.size) + 1.0)
    p = np.fft.irfft(spec, n=n)
    p *= 10 ** (level_db / 20) / (np.sqrt(np.mean(p**2)) + 1e-12)
    return p.astype(np.float32)


def write_audio(path: Path, x: np.ndarray, sr: int = SR, codec: list[str] | None = None) -> Path:
    """Encode float audio with FFmpeg (codec args default to 16-bit PCM WAV)."""
    codec = codec or ["-c:a", "pcm_s16le"]
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0", *codec, str(path)],
        input=x.astype("<f4").tobytes(),
        check=True,
    )
    return path


@pytest.fixture()
def tmpdir_path(tmp_path) -> Path:
    return tmp_path
