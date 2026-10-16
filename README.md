# Audio Sentinel

AI-assisted audio forensics: analyse uploaded or recorded audio for signs of editing, splicing and
AI-generated speech, see every suspicious interval on an interactive timeline, compare an alleged
original with a suspected edit, and export an evidence-based PDF report.

Audio Sentinel reports **indicators for expert review**, never proof. Every result names the check or
model that produced it, its calibration and its limitations, and a clean result is never presented as
proof of authenticity.

| | |
|---|---|
| Frontend | React 19 + TypeScript, Tailwind CSS 4, Radix UI primitives, wavesurfer.js 7, TanStack Query |
| API | Python 3.11+ / FastAPI, SQLAlchemy 2, Alembic, PostgreSQL |
| Analysis | NumPy, SciPy, librosa, soxr, FFmpeg; PyTorch + Transformers for the ML detectors |
| Jobs | PostgreSQL-backed job queue (`SELECT … FOR UPDATE SKIP LOCKED`) and worker processes |
| Storage | Private storage (local disk or S3) with per-object AES-256-GCM encryption |

## What it does

* **Upload, record or import** WAV, MP3, M4A/AAC, OGG/Opus, FLAC, WebM, AMR, AIFF and CAF, including
  messaging-app voice notes and browser microphone recordings (with the browser's noise suppression,
  echo cancellation and automatic gain switched off). Files are sniffed by content, probed and
  decoded in a sandboxed FFmpeg invocation, hashed (SHA-256) and stored encrypted.
* **Edit and splice detection** with ten signal-processing checks: background-noise continuity,
  bandwidth (codec/channel cutoff) consistency, acoustic change (ΔBIC), waveform clicks and DC steps,
  digital silence (with noise-gate pattern recognition), speech-level steps, pitch jumps, truncated
  reverberation and decay changes, duplicated (copy–moved) audio, and mains-hum (ENF) phase continuity.
  Evidence is fused across independent families so that agreement counts and isolated weak signals do not.
* **Synthetic-speech detection** with two documented pretrained models scored on overlapping 4 s windows:
  NII **AntiDeepfake Wav2Vec2-Small** (post-trained on 74k h of real and fake speech) and **AASIST**
  (ASVspoof 2019 LA, reference only). Only detectors calibrated on held-out data may influence verdicts.
* **Interactive forensic timeline**: waveform, server-side full-band spectrogram, window-level
  synthetic-speech probabilities, flagged regions, zoom/scroll, segment selection and replay;
  findings are synchronised with the timeline.
* **Original-vs-edited comparison**: fingerprint alignment robust to cuts, insertions, re-ordering and
  re-encoding; reports added, removed, changed and re-ordered segments, splice points, level and speed
  differences — all confirmed by direct comparison.
* **Reports**: comprehensive web report and on-demand PDF (file identity and hash, assessments, findings
  with evidence and alternative explanations, model versions and licences, calibration provenance,
  quality issues, limitations, recommendations, chain of custody).
* **Security and privacy**: session authentication, CSRF protection, ownership checks, rate limiting,
  encrypted private storage with no public URLs, configurable retention and automatic purge,
  delete-after-analysis, user-controlled deletion of recordings, reports and the account, an audit log,
  no training on user audio, and no speaker identification.

Result categories: *No significant manipulation indicators detected* · *Possible manipulation detected* ·
*Strong indicators of synthetic or manipulated audio* · *Inconclusive — more evidence required*.

## Quick start (development)

Requirements: Python 3.11+, Node 20+, FFmpeg, PostgreSQL 14+ (SQLite works for local experiments).

```bash
# Backend
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -e ".[dev]"            # signal analysis only
pip install torch --index-url https://download.pytorch.org/whl/cpu && pip install -e ".[ml]"   # ML detectors
python -m app.cli download-models   # AntiDeepfake (CC BY-NC-SA 4.0) + AASIST (MIT)
export AS_DATABASE_URL=postgresql+psycopg://sentinel:sentinel@localhost/audio_sentinel
export AS_COOKIE_SECURE=false AS_EMBEDDED_WORKER=true
alembic upgrade head
uvicorn app.main:app --port 8000

# Frontend (separate terminal) — proxies /api to :8000
cd frontend && npm install && npm run dev   # http://localhost:5173
```

`AS_EMBEDDED_WORKER=true` runs a worker thread inside the API process. In production run workers
separately: `python -m app.jobs.worker`.

Tests: `cd backend && pytest` (60+ tests; ML tests run when weights are installed) and
`cd frontend && npm test && npm run typecheck`.

## Documentation

* [docs/FEATURE_STATUS.md](docs/FEATURE_STATUS.md) — what is operational, what is limited, what is not built
* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data model, analysis pipeline, decisions
* [docs/EVALUATION.md](docs/EVALUATION.md) — evaluation method and measured results
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — production deployment, configuration, operations
* [docs/SECURITY.md](docs/SECURITY.md) — threat model and security/privacy controls
* [evaluation/README.md](evaluation/README.md) — how to reproduce the evaluation and calibration
* [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) — model, dataset and software licences

## Important licensing note

The AntiDeepfake weights are licensed **CC BY-NC-SA 4.0 (non-commercial)**. Commercial deployments must
disable that detector (`AS_SYNTHETIC_DETECTORS=aasist`) or obtain a licence from NII; AASIST (MIT) alone
does not generalise well enough to be used for verdicts, so a commercial deployment then reports
synthetic-speech assessment as unavailable/inconclusive until another validated model is integrated.
