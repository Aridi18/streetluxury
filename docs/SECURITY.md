# Security and privacy

Uploaded audio is treated as sensitive personal information (it can identify people and contain
confidential speech). This document lists the controls and the residual risks.

## Controls

| Area | Control |
|------|---------|
| Authentication | Argon2id password hashes (argon2-cffi defaults), 10-character minimum, constant-time dummy verification for unknown accounts, generic login errors |
| Sessions | 256-bit random opaque tokens; only their SHA-256 is stored; HttpOnly, `SameSite=Strict`, `Secure` (production), `Path=/api`; 12 h lifetime; logout revokes server-side |
| CSRF | Every state-changing `/api` request must carry `X-Requested-With: AudioSentinel` (cannot be sent cross-origin without a CORS preflight that is not granted) and, when present, a same-origin `Origin` |
| Authorization | Every object query is scoped to its owner; foreign or malformed IDs return 404 (no existence oracle) |
| Rate limiting | Login/registration per IP and per e-mail, uploads and analyses per user; Redis-backed when `AS_REDIS_URL` is set |
| Upload validation | Streaming size limit (default 100 MB), content sniffing by magic bytes (extension and declared type are ignored), ffprobe validation, duration limits, rejection of video and of undecodable files |
| Media sandboxing | FFmpeg/ffprobe always run with the sniffed demuxer forced (`-f`) and `-protocol_whitelist file`, so playlists, concat lists and URLs inside uploads are never followed; process timeouts |
| Storage | Per-object AES-256-GCM in 64 KiB chunks with HKDF-derived per-object keys; chunk index and last-chunk flag authenticated (reordering/truncation detected); private directory (0700/0600) or private S3 bucket with SSE; **no public or pre-signed URLs** — audio is streamed through authenticated endpoints |
| Integrity | SHA-256 of every original is recorded at upload and re-verified before processing; the original can be downloaded byte-identical for independent verification |
| Temporary files | Per-job private directories under `AS_TEMP_DIR`, deleted in `finally` blocks; stale directories swept hourly |
| Retention | Per-user retention (1–365 days, default 30) enforced by an hourly sweep; optional deletion of audio immediately after analysis; reports are generated on demand and never stored |
| Deletion | Users can delete individual recordings (cascades to analyses/comparisons and all stored objects), all data, or the account (including the audit log) |
| Headers | CSP (`default-src 'none'` for the API, strict self-only policy for the SPA), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: no-referrer`, COOP/CORP, HSTS when secure cookies are on, `Cache-Control: no-store` for API responses |
| Secrets | Read only from server environment variables; the SPA contains no keys. Production refuses to start without an encryption key or with insecure cookies |
| Model supply chain | AASIST weights are verified against a pinned SHA-256; AntiDeepfake is pinned to a Hugging Face revision; PyTorch weights load with `weights_only=True` |
| Data use | No code path uses recordings for training. The research-consent flag only records an informed opt-in (default off) |
| Speaker identity | Not implemented, by design. Voice-clone detection does not identify speakers |

## Residual risks and operator responsibilities

* **Key management**: losing `AS_STORAGE_ENCRYPTION_KEY` makes all recordings unrecoverable; leaking it
  together with the storage exposes them. Store it in a secrets manager, separate from backups.
* **TLS** must be terminated by a reverse proxy; the app sets `Secure` cookies and HSTS but does not
  serve TLS itself.
* **FFmpeg** decodes untrusted input. Keep it patched; consider running workers in a further sandbox
  (seccomp/AppArmor, read-only root filesystem, no outbound network).
* **In-memory rate limiting** is per process; set `AS_REDIS_URL` when running more than one API process.
* **E-mail verification, password reset and MFA** are not implemented (see FEATURE_STATUS.md).
* **Audit log** is stored in the same database as the data it describes; ship it to append-only storage
  if it must be tamper-evident.
