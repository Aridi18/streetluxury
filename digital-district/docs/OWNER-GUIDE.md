# Owner guide

This guide explains how to run Digital District day to day. You don't need technical knowledge — everything is done in the admin panel at **digitaldistrict.store/admin**.

## Before you launch — checklist

Work through this list once. Each item is something only you can provide or decide.

1. **Create your owner account** with the one-time invitation link (see the deployment guide), then go to **My security** and turn on two-step verification.
2. **Upload your original logo** — *Store settings → Store details & brand*. Upload the exact file (PNG with transparent background is best). It is shown exactly as uploaded, never recoloured or cropped. Until then, a plain text wordmark is shown.
3. **Check contact details** — WhatsApp number (+961 81 745 567), support email, hours, social links. These were imported from your previous site.
4. **Set up payment methods** — *Payment methods*. "Confirm payment on WhatsApp" (your current process) and "Cash on delivery" are on. **Whish Money, OMT, USDT and bank transfer are off** until you enter the exact instructions (account/phone number, account name, wallet address and network). Add processing fees if you pay any, so profit is accurate.
5. **Enter cost prices** — the dashboard warns you about products without a cost price. Open each product → *Options, prices & stock* → *Cost price*. Without costs, profit figures are overstated.
6. **Review prices and plans** — all 55 products and 69 plans were imported with the prices from your previous site. Products marked "On request" show a WhatsApp quote button instead of a price.
7. **Add real product photos** — products without photos show a clean lettered tile. Upload photos you have the right to use.
8. **Physical products** (when you start selling them): set real fees on *Delivery zones* and activate the areas you serve (all are off by default), or enable pickup in *Store settings*. Then update the **Terms** (section 4 says products are digital) and the **Refund policy** for physical returns.
9. **Legal pages** — your previous Terms, Privacy and Refund texts were imported; the privacy policy was updated to describe accounts, email and cookies accurately. Have them reviewed by a professional.
10. **Email** — ask your technical contact to configure an email provider (see the deployment guide) so customers get order emails.
11. **Place a test order** of each type (website, WhatsApp), verify a payment, deliver it, and cancel/refund one to see the full flow.

## Daily work

### New orders
- New orders appear on the **Dashboard**, in **Orders**, and in **Notifications** (bell icon).
- **WhatsApp orders** arrive as *Pending confirmation*. Opening WhatsApp doesn't prove the customer sent the message or paid. When you agree with the customer, open the order and change the status to *Confirmed* (or *Awaiting payment*).
- **Reject** an order with *Reject / cancel order* and a reason. Stock is returned automatically. Orders that already have payments must be refunded first.
- Unconfirmed, unpaid orders are cancelled automatically after 72 hours (change this in *Store settings → Checkout*), which also returns their stock.

### Payments
- **Transfers (Whish, OMT, USDT, bank):** the customer enters the transaction reference and can upload a screenshot. The payment shows as *Pending verification*. Check your account; then **Verify payment** (adjust the amount if you received a different amount) or **Reject** with a reason. Your name and the time are recorded.
- **Cash on delivery / agreed on WhatsApp:** when you receive the money, use **Record a payment received** on the order.
- **Card payments** (when connected) are confirmed automatically by checking with the bank.
- An order is counted as a sale only when it is fully paid.

### Digital delivery
- When an order is paid, products set to **Automatic** delivery get their licence keys or download links instantly.
- For **Manual** products (most subscriptions), open the order → *Digital delivery* → **Deliver now**: type the access details (account, password, profile, PIN, link, steps). They are stored encrypted and shown only on the customer's private order page; the customer gets an email with a link (if email is set up). Set the end date for subscriptions — customers get a renewal reminder before it ends.
- If something goes wrong, mark the delivery as failed with a reason, or revoke access.

### Physical delivery
- Open the order → *Shipping & fulfilment* → **Create shipment**: choose items and quantities (partial shipments are supported), courier, tracking number/link and what the courier cost you (recorded as an expense). Update the shipment to *Delivered* when it arrives — the order follows automatically.

### Refunds
- Open the order → **Record a refund**: amount, reason, how you paid it back. Tick *Return to stock* for physical items you received back. Fully refunded digital items lose access.

### Talking to customers
- Every order and customer page has a **WhatsApp** button with a prepared message. Use **Private notes** on orders and customers for internal information (never card numbers).

## Products

- **Add a product** — the simple form asks only for the essentials. You can complete the rest later.
- **Options** — for plans (1 Month / 3 Months) or variants (Color, Storage): each option has its own price, "was" price, cost price, stock and duration.
- **Questions for the customer** — e.g. "Email to activate on". Answers appear on the order.
- **Licence keys** — paste keys (one per line). Each key is one unit of stock and is released automatically when paid.
- **Statuses** — *Active* (visible), *Draft*, *Hidden*, *Archived*. Products with past orders are archived rather than deleted so your history stays intact.
- **Bulk changes** — *Export CSV*, edit in Excel/Google Sheets, then *Import CSV* (always run a check first).

## Stock

- Turn on **Track stock** for physical products. Stock goes down when an order is placed (so you never sell the same item twice) and comes back if the order is cancelled.
- Use **Inventory** for counts and corrections (every change needs a reason and is logged) and **Suppliers & purchases** when you buy stock — this adds stock and updates the average cost automatically.
- You get a notification when an item reaches its low-stock level.

## Promotions

- **Automatic sale** (no code): pick percentage or amount, products/categories and dates. Prices update in the store with the old price struck through and a live countdown.
- **Coupon code**: customers enter it in the cart. You can set a minimum order, total and per-customer limits, first-order-only, and dates.

## Reports

*Reports & profit* shows net sales, cost of goods, gross profit, expenses and estimated net profit for any period, plus cash collected and unpaid balances. Record expenses (ads, courier, packaging, tools, salaries…) in **Expenses** so profit is complete. See [ACCOUNTING.md](ACCOUNTING.md) for the definitions. This is a management view, not certified accounting or tax reporting.

## Website content

- **Homepage & banners** — turn sections on/off, change their order, edit the hero text, benefits and steps; add scheduled banners with images.
- **Pages & FAQs** — About, Terms, Privacy, Refund policy, Delivery information and any new page; questions and answers.
- **Store settings** — logo, contact details, announcement bar, social links, SEO, tax, pickup, checkout options.

## Team

Invite staff in **Staff & roles**. Each person has their own login and a role:

| Role | Can do |
|---|---|
| Owner / Super Admin | Everything, including settings, staff, payment methods and the audit log |
| Product Manager | Products, categories, stock, promotions, website content, reviews |
| Order Manager | Orders, payments verification, fulfilment, customers, support |
| Fulfilment Staff | View orders, ship and deliver, stock |
| Finance / Reports Viewer | Reports, expenses, payment verification, refunds |
| Customer Support | View orders, customers, support requests, reviews |

Remove access by changing the role or unticking *Active* — they are signed out immediately. Turn on *Require two-step verification for all staff* in Store settings.

## Privacy requests

Customers can download their data and request deletion from their account. Deletion requests appear in **Support requests**; open the customer and use **Delete personal data**. Anonymous sales figures remain for your accounts.
