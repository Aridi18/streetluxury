# Accounting definitions

The reports in the admin panel are a **management accounting view** — estimates to help run the business, based on what is recorded in the store. They are not certified accounting or tax reporting. All amounts are in USD; periods use Lebanon time (Asia/Beirut).

## When is something a sale?

An order is recognised as a sale on the date it **first becomes fully paid** (`paidAt`). Therefore:

- Unpaid orders, WhatsApp orders not yet paid, and transfers still awaiting verification are **never** revenue.
- Cancelled orders are never revenue (an order with payments must be refunded before it can be cancelled).
- Partially paid orders appear in *cash collected* but not in sales until fully paid.

## Profit & loss

| Line | Definition |
|---|---|
| **Gross sales** | For orders recognised in the period: each item's regular (list) price × quantity, plus delivery fees charged. |
| **Discounts** | Automatic sale discounts (regular price − sale price) plus coupon discounts on those orders. A "was" price shown for marketing is *not* a discount — only the regular price is used. |
| **Refunds** | Refund amounts recorded in the period (by refund date). |
| **Tax included in prices** | When prices include tax, the tax portion is removed — it is collected for the government, not revenue. When tax is added on top, it was never in gross sales. |
| **Net sales** | Gross sales − discounts − refunds − tax included in prices. |
| **Cost of goods sold (COGS)** | Each item's cost price *as recorded when the order was placed* × quantity, for orders recognised in the period, minus the cost of items returned to stock through refunds in the period. |
| **Gross profit** | Net sales − COGS. |
| **Operating expenses** | Expenses in *operating* categories dated in the period (ads, courier, packaging, tools, rent, salaries, bank fees…) **plus payment processing fees** recorded on verified payments. Courier costs entered on shipments are recorded automatically as expenses. |
| **Operating profit (estimate)** | Gross profit − operating expenses. |
| **Other expenses** | Expenses in *other* categories (e.g. interest, taxes and government fees). |
| **Net profit (estimate)** | Operating profit − other expenses. |

## Cash and balances (shown separately, never mixed with profit)

| Figure | Definition |
|---|---|
| **Cash collected** | Payments verified (or captured by the card gateway) in the period. |
| **Cash refunded** | Refunds recorded in the period. |
| **Net cash in** | Cash collected − cash refunded. |
| **Tax collected** | Tax on recognised orders (whether included or added). |
| **Inventory purchases** | Stock bought in the period (*Suppliers & purchases*). Not an expense: it becomes COGS when the items sell. |
| **Unpaid balance** | Amount still due on open, non-cancelled orders (all dates). |
| **Awaiting verification** | Amount on orders whose submitted payment hasn't been checked yet. |

## Cost prices

- Each option (variant) has a cost price. The cost at the moment of ordering is saved on the order, so later cost changes never rewrite history.
- Recording a purchase updates the cost with the **weighted average** method: new cost = (current stock × current cost + received quantity × purchase unit cost) ÷ new stock. Shipping and other purchase costs are spread across the items by value.
- Items without a cost price count as zero cost — the dashboard warns you about them.

## Average order value

(Gross sales − discounts) ÷ number of recognised orders.

## Exports

*Reports* → **P&L CSV** exports the statement for the selected period; orders, products, inventory, expenses, customers and newsletter subscribers can also be exported. Every export is recorded in the audit log.
