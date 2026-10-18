# Architecture

## Overview

A single Next.js 16 application (App Router, React Server Components, server actions) backed by PostgreSQL through Prisma. Pages are rendered on the server for every request, so prices, stock and offers are always current. Business rules live in `src/lib/` and are covered by tests against a real database.

```
Browser ──HTTPS──> Caddy ──> Next.js app ──> PostgreSQL
                               │   └──> storage volume (public images | private files & proofs)
                               ├──> SMTP provider (optional)
                               └──> Card gateway (optional, server-to-server verification)
Scheduler ──POST /api/cron (every 15 min)──> app
```

## Main modules (`src/lib`)

| Module | Responsibility |
|---|---|
| `pricing.ts` | Pure price engine: automatic sales, coupons, allocation of discounts to lines, delivery fees, tax. |
| `cart.ts` | Guest/user carts, validation of options and stock, cart merge on sign-in, priced cart views. |
| `checkout.ts` | `placeOrder`: one transaction that re-prices, validates, deducts stock, snapshots items, records coupon usage and creates pending deliveries. Idempotent. |
| `orders.ts`, `order-core.ts`, `order-status.ts` | Status machine, cancellation (stock return), refunds, history, payment-status derivation. |
| `payments.ts` | Manual payment submission/verification/rejection, recorded payments, card gateway (hosted checkout + server verification). |
| `fulfillment.ts` | Automatic digital delivery (licence keys, files), manual delivery (encrypted), shipments and partial fulfilment. |
| `inventory.ts` | Atomic stock deduction/restoration, adjustments, purchases with weighted-average cost, low-stock alerts. |
| `reports.ts` | Management accounting queries (see ACCOUNTING.md). |
| `auth.ts`, `permissions.ts`, `accounts.ts` | Sessions, roles and permissions, invitations, tokens. |
| `catalog.ts` | Storefront queries, search, filters, product cards. |
| `jobs.ts` | Scheduled jobs: auto-cancel stale orders, renewal reminders, cleanup. |

## Data model (main tables)

Users, sessions, tokens, staff invitations, addresses, customer notes · categories (nested), brands, tags, products, product images, product variants (price, cost, stock, duration), collections · inventory movements, suppliers, purchases · carts and cart items, wishlist · delivery zones · orders, order items (price/cost/name snapshots), status history, notes · payment methods, payments, payment events, refunds · shipments, digital assets, licence keys, digital deliveries, download logs · promotions and usage · reviews · expenses and expense categories · settings, banners, pages, FAQs, newsletter subscribers, support requests, notifications, email log, audit log.

All money is stored as integer cents. Historical records use soft deletion or snapshots so later edits never rewrite past orders. Database constraints guard quantities, amounts and refund bounds.

## Order lifecycle

```
Website (transfer/card) ─> AWAITING_PAYMENT ─┐
Website (COD/arranged) ─> PENDING ───────────┼─> CONFIRMED ─> PROCESSING ─> (PARTIALLY_FULFILLED) ─> SHIPPED / READY_FOR_PICKUP ─> DELIVERED ─> COMPLETED
WhatsApp ───────────────> PENDING ───────────┘                       (digital-only orders complete automatically when paid and delivered)
Any unpaid open order ─> CANCELLED (stock returned)          Refunds ─> PARTIALLY_REFUNDED / REFUNDED
```

Payment status is tracked separately: UNPAID, PENDING_VERIFICATION, PARTIALLY_PAID, PAID, FAILED, PARTIALLY_REFUNDED, REFUNDED.

## Inventory policy

- Stock is deducted when an order is placed (website or WhatsApp) to prevent overselling, using an atomic conditional update.
- Cancelling, rejecting or auto-expiring an order returns its stock; refunds return stock only when staff tick "return to stock".
- Variants with stock tracking off (most digital services) are unlimited. Licence-key variants track one unit per key.
- Backorders are only possible when explicitly enabled on a variant.

## Testing

- `tests/unit` — pricing, phone numbers, money, WhatsApp encoding, TOTP, status rules, time zones.
- `tests/integration` — checkout (snapshots, idempotency, concurrent oversell, coupons), payments, digital and physical fulfilment, refunds, the profit & loss calculation and scheduled jobs, against PostgreSQL.
- `tests/e2e` — browser flows: search → cart → website checkout, WhatsApp checkout, order privacy, admin product creation with photo upload, payment recording and delivery, coupons, and access control.
