# syntax=docker/dockerfile:1.7
# Digital District — production image (Next.js standalone server).

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Full dependencies + build. Also used by the one-off "migrate" service (it has the Prisma CLI and tsx).
FROM base AS builder
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npx next build

# Minimal runtime
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/data/storage
RUN groupadd --system --gid 1001 app && useradd --system --uid 1001 --gid app app && mkdir -p /data/storage && chown -R app:app /data
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
