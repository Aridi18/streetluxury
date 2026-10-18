# Deployment — putting Digital District online at digitaldistrict.store

The store runs as four containers on one server: **PostgreSQL** (database), the **app**, a **scheduler** (runs maintenance every 15 minutes) and **Caddy** (HTTPS with free automatic certificates). This setup has been built and tested with Docker.

## 1. What you need

- A Linux server (VPS) with **2 GB RAM** or more, **Ubuntu 24.04**, and a public IP address. Any reputable provider works (for example Hetzner, DigitalOcean, Vultr, OVH). A provider with a data centre in Europe gives good speed from Lebanon.
- Access to the DNS settings of **digitaldistrict.store** (where the domain was bought, or where its DNS is managed — if it currently points to the Lovable site, you change it here).
- Optional: an email-sending provider (section 6) and a card-payment merchant account (section 7).

## 2. Prepare the server

```bash
# As root on the new server
apt update && apt -y upgrade
curl -fsSL https://get.docker.com | sh          # installs Docker + Compose
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
adduser --disabled-password --gecos "" deploy && usermod -aG docker deploy
```

## 3. Point the domain at the server

In your DNS settings create (or change) these records, replacing `203.0.113.10` with your server's IP:

| Type | Name | Value |
|---|---|---|
| A | `@` (digitaldistrict.store) | `203.0.113.10` |
| A | `www` | `203.0.113.10` |

Remove any old A/AAAA/CNAME records for `@` and `www` that point elsewhere (for example to Lovable). DNS changes can take from a few minutes to a few hours. Check with `dig +short digitaldistrict.store`.

Links from the old site (like `digitaldistrict.store/netflix`) keep working: they redirect permanently to the new product pages.

## 4. Install the store

```bash
su - deploy
git clone <your repository URL> digital-district-repo
cd digital-district-repo/digital-district
cp .env.example .env
nano .env
```

Fill in `.env`:

| Setting | Value |
|---|---|
| `APP_URL` | `https://digitaldistrict.store` |
| `SITE_DOMAIN` | `digitaldistrict.store` |
| `POSTGRES_PASSWORD` | a long random password — `openssl rand -hex 24` |
| `DATABASE_URL` | leave as is (Compose sets it) |
| `DATA_ENCRYPTION_KEY` | `openssl rand -base64 32` — **keep a copy somewhere safe**: without it, encrypted licence keys and delivery details can't be read |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `SMTP_URL`, `EMAIL_FROM`, `OWNER_ALERT_EMAIL` | see section 6 (optional) |
| `MPGS_*` | see section 7 (optional) |

Start everything:

```bash
docker compose up -d --build                  # first build takes a few minutes
docker compose --profile tools run --rm migrate   # creates the tables and imports your catalog (run once)
docker compose ps                             # all services should be "running"/"healthy"
```

Open https://digitaldistrict.store — Caddy obtains the HTTPS certificate automatically on the first visit (DNS must already point to the server).

## 5. Create the owner account

```bash
docker compose --profile tools run --rm migrate npm run owner:invite -- your-email@example.com "Your Name"
```

This prints a one-time link valid for 72 hours. Open it, choose a strong password, sign in at `/admin`, and turn on two-step verification under **My security**. No default password exists anywhere in the code. Invite your team from **Staff & roles**.

Then follow the launch checklist in [OWNER-GUIDE.md](OWNER-GUIDE.md).

## 6. Email (recommended)

Order confirmations, payment and delivery notifications, password resets and renewal reminders are emailed when SMTP is configured. Without it, the store works normally and the *Email log* shows what wasn't sent.

Use a transactional email provider (for example Brevo, Mailgun, Postmark, Amazon SES, or Zoho Mail), verify your domain with it, and add the SPF/DKIM DNS records it gives you so emails don't land in spam. Then set:

```
SMTP_URL="smtps://USERNAME:PASSWORD@smtp.provider.com:465"
EMAIL_FROM="Digital District <orders@digitaldistrict.store>"
OWNER_ALERT_EMAIL="your-email@example.com"
```

Apply changes with `docker compose up -d`.

## 7. Online card payments (optional)

Most international gateways (such as Stripe) don't accept merchants based in Lebanon. The store integrates **Mastercard Payment Gateway Services hosted checkout**, which Lebanese acquiring banks and processors (for example **areeba**) offer to local merchants. Card details are entered on the bank's page and never reach this server; a payment is only marked as paid after the server confirms it directly with the gateway.

1. Apply for an e-commerce merchant account with your bank/areeba and ask for "Mastercard Gateway Hosted Checkout (API version 100)". You'll receive a gateway URL, merchant ID and API password.
2. Set in `.env`:
   ```
   MPGS_GATEWAY_URL="https://<gateway host given by your acquirer>"
   MPGS_MERCHANT_ID="..."
   MPGS_API_PASSWORD="..."
   MPGS_API_VERSION="100"
   MPGS_WEBHOOK_SECRET="<notification secret from the merchant portal>"
   ```
3. In the merchant portal, set the webhook/notification URL to `https://digitaldistrict.store/api/payments/mpgs/webhook`.
4. `docker compose up -d`, then enable **Credit or debit card** in *Payment methods*.
5. Test in the gateway's test mode with test cards before going live. This integration follows the gateway's documented API but has not been tested against a live merchant account — do a real low-value payment and refund before announcing it.

## 8. Backups

Back up every day, and keep copies **off the server**:

```bash
crontab -e
# add:
15 3 * * * cd /home/deploy/digital-district-repo/digital-district && sh scripts/backup.sh >> backups/backup.log 2>&1
```

This saves the database and uploaded files to `backups/` (14 days kept). Copy that folder elsewhere regularly (for example with `rclone` to cloud storage) — many VPS providers also offer automatic server snapshots; turn them on.

**Restore** (on a fresh install, after step 4):

```bash
docker compose up -d db
cat backups/db-YYYYMMDD-HHMMSS.dump | docker compose exec -T db pg_restore -U dd -d digital_district --clean --if-exists
docker compose run --rm --no-deps -v "$PWD/backups":/backup --entrypoint sh app -c "tar -xzf /backup/storage-YYYYMMDD-HHMMSS.tar.gz -C /data"
docker compose up -d
```

Use the same `DATA_ENCRYPTION_KEY` as before.

## 9. Updating

```bash
cd digital-district-repo && git pull
cd digital-district
docker compose up -d --build
docker compose --profile tools run --rm migrate   # applies new migrations; the seed never overwrites your edits
```

## 10. Monitoring

- `https://digitaldistrict.store/api/health` returns `{"ok":true}` when the app and database are working. Add it to a free uptime monitor (for example UptimeRobot) to get alerted if the site goes down.
- Logs: `docker compose logs -f app`.

## Alternative: managed hosting

The app is a standard Next.js server and can also run on platforms such as Render or Railway with a managed PostgreSQL database. In that case uploaded files must live on persistent disk storage, and the scheduler should call `POST /api/cron` with `Authorization: Bearer <CRON_SECRET>` every 15 minutes. The Docker setup above is the tested, recommended path.
