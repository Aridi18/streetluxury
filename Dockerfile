# syntax=docker/dockerfile:1.7
# Multi-stage build:
#   docker build --target api    -t audio-sentinel-api .     # API + built web app (no ML)
#   docker build --target worker -t audio-sentinel-worker .  # analysis worker with PyTorch models

FROM node:22.12-bookworm-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund --maxsockets=6 --fetch-retries=5
COPY frontend/ ./
RUN npm run build

FROM python:3.12.8-slim-bookworm AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    AS_ENV=production AS_STORAGE_DIR=/data/objects AS_TEMP_DIR=/data/tmp \
    AS_MODEL_DIR=/models AS_CALIBRATION_DIR=/app/calibration
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libsndfile1 tini \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --home /app sentinel \
 && mkdir -p /data/objects /data/tmp /models && chown -R sentinel /data /models
WORKDIR /app
COPY backend/pyproject.toml ./
COPY backend/app ./app
RUN pip install --upgrade pip && pip install .
COPY backend/alembic.ini ./
COPY backend/alembic ./alembic
COPY backend/calibration ./calibration
COPY THIRD_PARTY_NOTICES.md ./

FROM base AS api
COPY --from=web /web/dist /app/frontend-dist
ENV AS_FRONTEND_DIST=/app/frontend-dist
USER sentinel
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4)"
ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips='*'"]

FROM base AS worker
RUN pip install torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install "transformers>=4.44" "safetensors>=0.4" "huggingface_hub>=0.24"
USER sentinel
ENTRYPOINT ["tini", "--"]
# Weights are downloaded once into the /models volume: docker compose run worker python -m app.cli download-models
CMD ["python", "-m", "app.jobs.worker"]
