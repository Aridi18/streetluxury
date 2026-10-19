# Digital District — e-commerce platform

The complete online store for **Digital District** (digitaldistrict.store): a storefront for digital services, software, subscriptions, licences and physical products, with website checkout, WhatsApp ordering, an admin panel, inventory, digital delivery and profit reporting.

> **DIGITAL SERVICES. LIMITLESS ACCESS.**

## What's included

**Storefront**
- Homepage built from admin-managed sections: hero/banners with schedules, prominent search, categories, live offers with real countdowns, bestsellers, featured, new arrivals, collections, recently viewed, verified reviews, how-it-works, guarantees and a consent-based newsletter.
- Shop, category, brand, collection and offers pages with real search (names, descriptions, categories, brands, SKUs, tags), filters (price, type, brand, stock, on sale), sorting and pagination. Search suggestions as you type.
- Product pages with photo gallery and video, options/variants with their own prices and stock, customer questions (e.g. "email to activate on"), notes, delivery and warranty information, wishlist, sharing, WhatsApp enquiries, related products and verified-purchase reviews.
- Cart with quantities, save for later, coupons and server-calculated totals.
- **Two ways to order:** website checkout, or *Order via WhatsApp* — the order is saved first, then a properly encoded message with every detail opens in WhatsApp (with WhatsApp Web and copy-message fallbacks).
- Guest checkout or customer accounts: orders, digital library and download history, wishlist, addresses, reorder, support and return requests, security, data export and deletion requests.
- Order pages show payment instructions, accept transaction references/proofs, and reveal delivered access details, licence keys and downloads only to the buyer.

**Admin panel (`/admin`)** — role-based (Owner, Product Manager, Order Manager, Fulfilment, Finance, Support), enforced on the server.
- Dashboard with live metrics and charts from real records.
- Orders: search and filters, confirm/reject, controlled status changes, payment verification (with who/when), recording payments, refunds with restocking, shipments with tracking and partial fulfilment, manual and automatic digital delivery, private notes, invoices, CSV export, complete history.
- Products: simple "add a product" form, full editor (variants, prices, cost prices, stock, photos, licence keys, downloadable files, delivery, policies, SEO), duplicate, archive, CSV import/export.
- Categories (nested), brands, collections, inventory with audited adjustments, suppliers and purchases (weighted-average cost), promotions and coupons.
- Finance: profit & loss, cash view, product/category/payment-method performance, expenses, CSV exports — a management accounting view.
- Customers, reviews moderation, support requests, homepage/banners, pages and FAQs, newsletter, store settings and logo, payment methods, delivery zones, staff invitations, audit log, email log, two-step verification.

The catalog, contact details, FAQs and policy texts from the previous storefront are imported by the seed (55 products, 69 plans, 13 categories), so the store starts with real data.

## Technology (in plain words)

| Part | Choice | Why |
|---|---|---|
| Website & server | **Next.js 16** (React 19, TypeScript) | One codebase renders fast pages on the server (good for Google and slow mobile connections) and runs the secure server logic. |
| Database | **PostgreSQL 16** with **Prisma** | A reliable relational database with migrations, constraints and transactions — orders, stock and money stay consistent. |
| Styling | **Tailwind CSS 4** | A consistent design system: black/charcoal with purple and white accents. |
| Images | **sharp** | Uploaded photos are verified, cleaned of metadata and converted to small WebP files. |
| Email | SMTP (any provider) | Optional; without it everything still works and messages are logged. |
| Card payments | Mastercard Gateway hosted checkout (e.g. areeba) | Supports Lebanese merchants; card details never touch this server. Off until credentials are added. |
| Hosting | Docker Compose + Caddy | One command runs the database, app, scheduler and HTTPS with automatic certificates. |

Money is stored in integer cents (USD) to avoid rounding errors, and every total is recomputed on the server.

## Try it on your computer (easiest)

1. Install **Docker Desktop** (free) from docker.com and start it.
2. Download this repository (GitHub → **Code → Download ZIP**, then unzip) or `git clone` it, and open a terminal in the `digital-district` folder.
3. Run:
   ```bash
   docker compose -f docker-compose.local.yml up --build
   ```
   The first start takes a few minutes. When it's ready, the output shows **“Create your owner account here:”** with a link.
4. Open that link, choose a password, then sign in with `owner@example.com`.
   - Store: http://localhost:3000 — Admin: http://localhost:3000/admin
   - Lost the link? Run `docker compose -f docker-compose.local.yml logs setup`.

Stop with **Ctrl+C**; your test data is kept for next time. To erase it and start fresh: `docker compose -f docker-compose.local.yml down -v`. This trial setup uses fixed local-only secrets — for the real store use `docker-compose.yml` and `docs/DEPLOYMENT.md`.

## Quick start (development)

Requirements: Node.js 22+, PostgreSQL 16.

```bash
cp .env.example .env            # set DATABASE_URL, DATA_ENCRYPTION_KEY (openssl rand -base64 32), CRON_SECRET
npm install
npx prisma migrate deploy       # create the tables
npm run db:seed                 # import the catalog, settings, FAQs and policies
npm run owner:invite -- you@example.com "Your Name"   # prints a one-time link to create the owner account
npm run dev                     # http://localhost:3000
```

## Commands

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Develop, build and run the production server |
| `npm test` | Unit and integration tests (uses `TEST_DATABASE_URL`, default `digital_district_test`) |
| `npm run test:e2e` | Browser tests against a running app (`E2E_BASE_URL`, default `http://localhost:3000`) |
| `npm run lint` / `typecheck` | Code quality checks |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Seed (safe to re-run; never overwrites admin edits) |
| `npm run owner:invite -- email "Name"` | Create a one-time owner invitation link |
| `npm run jobs:run` | Run scheduled jobs once |
| `npm run db:studio` | Browse the database (Prisma Studio) |

## Project layout

```
prisma/            schema, migrations, seed (+ seed-data from the previous storefront)
src/lib/           server logic: pricing, cart, checkout, orders, payments, fulfilment, inventory, reports, auth…
src/app/(store)/   storefront pages     src/app/admin/   admin panel     src/app/api/   files, exports, payments, cron
src/components/    UI components
tests/             unit + integration (Vitest, real PostgreSQL) and end-to-end (Playwright)
deploy/            Caddy (HTTPS) configuration     scripts/   owner invitation, jobs, backups
docs/              owner guide, deployment, accounting, security, architecture
```

## Documentation

- [Owner guide](docs/OWNER-GUIDE.md) — running the store day to day, and the launch checklist.
- [Deployment](docs/DEPLOYMENT.md) — server setup, domain, HTTPS, email, card payments, backups, updates.
- [Accounting](docs/ACCOUNTING.md) — how sales, profit and cash figures are calculated.
- [Security](docs/SECURITY.md) — protections in place and operating advice.
- [Architecture](docs/ARCHITECTURE.md) — data model, order and inventory rules.
