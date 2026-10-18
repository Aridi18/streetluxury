# Security

## Protections built in

**Accounts and access**
- Passwords are hashed with bcrypt (cost 12); minimum 10 characters with letters and numbers. No default or hard-coded admin password exists — the first owner is created through a one-time, expiring invitation link generated on the server.
- Sessions use random 256-bit tokens in `HttpOnly`, `SameSite=Lax`, `Secure` cookies; only a SHA-256 hash is stored. Staff sessions last 12 hours, customer sessions 30 days. Changing a password or role signs out other sessions.
- Optional (or store-wide required) two-step verification (TOTP authenticator apps) for staff.
- Role-based permissions are checked **on the server** for every admin page, server action, export and file route — hiding the `/admin` link is not relied on.
- Rate limiting (stored in PostgreSQL) on sign-in, registration, password reset, checkout, coupon attempts, order lookup, contact and payment submissions.
- Password-reset and verification tokens are single-use, hashed and expire (1 hour / 7 days). Reset responses don't reveal whether an email exists.

**Orders and money**
- Every price, discount, delivery fee, tax and stock check is recomputed on the server inside a database transaction; totals from the browser are never trusted.
- Idempotency keys prevent duplicate orders from double clicks, refreshes or retries.
- Stock is deducted with an atomic conditional update under a row lock, so simultaneous buyers can't oversell (covered by an automated concurrency test).
- Payments are never marked paid without staff verification or server-to-server confirmation from the card gateway. Staff verification records who and when. Card numbers and CVV never reach this server (hosted checkout).
- Controlled order status transitions and a permanent audit log of significant admin actions.

**Data**
- Licence keys, delivered credentials and staff two-step secrets are encrypted at rest with AES-256-GCM (`DATA_ENCRYPTION_KEY`).
- Digital files and payment proofs are stored outside the public web root and are only served through authorised routes (buyers: limited, expiring downloads; proofs: staff only, sandboxed).
- Guest order pages require an unguessable per-order key; signed-in customers only ever see their own orders.
- Uploaded images are decoded and re-encoded (which strips metadata and rejects disguised files); proofs are identified by their content, not their file name.
- CSV exports neutralise spreadsheet formula injection.

**Web**
- Strict Content-Security-Policy with per-request nonces, `frame-ancestors 'none'`, HSTS, `nosniff`, strict referrer policy and a locked-down permissions policy.
- Next.js server actions include built-in origin checks (CSRF protection); state-changing API routes require a secret (`/api/cron`) or the gateway's notification secret.
- Owner-edited content is rendered as text through a minimal Markdown renderer — never as raw HTML.
- All inputs are validated on the server.
- Production dependencies had no known vulnerabilities (`npm audit --omit=dev`) at the time of writing.

## Operating advice

- Keep `.env` private; never commit it. Store a copy of `DATA_ENCRYPTION_KEY` in a password manager.
- Require two-step verification for staff (*Store settings*). Give each person their own account with the smallest role they need, and remove access when someone leaves.
- Apply updates regularly (`docs/DEPLOYMENT.md` → Updating) and keep the server patched (`apt upgrade`).
- Keep off-server backups and test a restore occasionally.
- Never ask customers for card numbers on WhatsApp or record them in notes.
