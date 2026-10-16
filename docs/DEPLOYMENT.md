# Deployment

## Topology

* **API** (`uvicorn app.main:app`): stateless; also serves the built web app (`AS_FRONTEND_DIST`). Scale
  horizontally behind a load balancer; set `AS_REDIS_URL` so rate limits are shared.
* **Workers** (`python -m app.jobs.worker`): CPU-bound analysis and model inference. Each worker runs one
  job at a time; run several processes or containers for throughput. Workers need FFmpeg, the ML
  dependencies and the model weights; the API needs neither.
* **PostgreSQL** 14+: metadata, results, job queue.
* **Object storage**: local encrypted directory (single host or shared volume) or a private S3 bucket.
* **Reverse proxy** with TLS (nginx, Caddy, a cloud load balancer). Allow request bodies up to
  `AS_MAX_UPLOAD_MB` and long-running uploads.

If your hosting platform cannot run Python inference (e.g. a static or serverless frontend host), host
the SPA there and run the API + workers on a container platform; set `AS_ALLOWED_ORIGINS` to the SPA's
origin and serve both under one parent domain so session cookies (SameSite=Strict) remain first-party —
or, preferably, route `/api` to the API through the same origin.

## Docker Compose

```bash
cp .env.example .env               # set POSTGRES_PASSWORD and AS_STORAGE_ENCRYPTION_KEY
docker compose up -d --build
docker compose run --rm worker python -m app.cli download-models   # once, into the models volume
docker compose logs -f worker
```

The API listens on `127.0.0.1:8000`; put your TLS proxy in front of it. Example (Caddy):

```
sentinel.example.org {
    request_body { max_size 110MB }
    reverse_proxy 127.0.0.1:8000
}
```

## Configuration

All settings are environment variables with the `AS_` prefix (see `backend/app/config.py` and
`.env.example`). The important ones:

| Variable | Default | Notes |
|----------|---------|-------|
| `AS_ENV` | `development` | `production` enables strict startup checks and disables API docs |
| `AS_DATABASE_URL` | local Postgres | `postgresql+psycopg://user:pass@host:5432/db` |
| `AS_STORAGE_ENCRYPTION_KEY` | — | **Required in production**: base64 of 32 random bytes |
| `AS_STORAGE_BACKEND` | `local` | `s3` with `AS_S3_BUCKET`, `AS_S3_REGION`, optional `AS_S3_ENDPOINT_URL` |
| `AS_COOKIE_SECURE` | `true` | Must be true in production (HTTPS) |
| `AS_TRUST_PROXY_HEADERS` | `false` | Enable behind a trusted proxy (client IPs for rate limits, Origin checks) |
| `AS_ALLOWED_ORIGINS` | — | Only for a cross-origin SPA |
| `AS_REDIS_URL` | — | Shared rate limiting |
| `AS_MAX_UPLOAD_MB` / `AS_MAX_DURATION_SECONDS` | 100 / 1800 | Upload limits |
| `AS_DEFAULT_RETENTION_DAYS` / `AS_MAX_RETENTION_DAYS` | 30 / 365 | Audio retention |
| `AS_SYNTHETIC_DETECTORS` | `antideepfake-w2v2-small,aasist` | Detectors enabled on workers |
| `AS_MODEL_DIR` | `backend/models_cache` | Weights location (`/models` in the image) |
| `AS_CALIBRATION_DIR` | `backend/calibration` | Calibration files |
| `AS_TORCH_THREADS` | 0 (library default) | Limit per-worker inference threads |
| `AS_ALLOW_REGISTRATION` | `true` | Disable for invite-only deployments (create users via the API from an admin network) |

## Database migrations

```bash
cd backend && alembic upgrade head
```

The API image runs this on start. Outside production the API also creates missing tables automatically.

## Models

```bash
python -m app.cli download-models   # AntiDeepfake (pinned HF revision) + AASIST (SHA-256 verified)
python -m app.cli detectors         # show what this worker can run and how it is calibrated
```

Workers report detector availability in their heartbeat; the *Models & system* page shows it. A detector
whose weights or dependencies are missing is reported as "Detection model not configured" and never
produces scores. **AntiDeepfake weights are CC BY-NC-SA 4.0 (non-commercial)** — see THIRD_PARTY_NOTICES.md.

## Calibration and evaluation

Calibration files in `backend/calibration/` are part of the release. After changing detectors, models or
thresholds, re-run the evaluation suite (`evaluation/README.md`) and commit the regenerated files.
Operators can calibrate on their own labelled data with the same scripts.

## Operations

* **Health**: `GET /api/health` (database check). Worker liveness and queue depth: *Models & system* page or
  `worker_heartbeats` / `jobs` tables.
* **Retention**: workers schedule an hourly retention sweep; `python -m app.cli purge` runs it manually.
* **Backups**: back up PostgreSQL and the object store together; back up the encryption key separately.
* **Resource sizing**: a worker needs ~1.5 GB RAM for a 30-minute recording plus ~0.7 GB for the models;
  CPU inference processes roughly 3–8× real time per core depending on recording length and checks.
* **Logs** contain no audio, transcripts or file contents; job errors are stored on the job row.

## Production checklist

- [ ] `AS_ENV=production`, `AS_COOKIE_SECURE=true`, TLS in front, `AS_TRUST_PROXY_HEADERS` set correctly
- [ ] `AS_STORAGE_ENCRYPTION_KEY` generated, stored in a secrets manager, backed up separately
- [ ] PostgreSQL credentials rotated from defaults; network access restricted to API and workers
- [ ] `AS_REDIS_URL` set if more than one API process
- [ ] Model licences reviewed (`AS_SYNTHETIC_DETECTORS` adjusted for commercial use)
- [ ] Calibration files present and evaluation summary reviewed on the *Models & system* page
- [ ] Retention defaults agreed with your privacy policy; deletion procedures documented for users
- [ ] Workers isolated (no inbound network; outbound only if downloading models)
