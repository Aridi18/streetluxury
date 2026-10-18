// Management accounting. See docs/ACCOUNTING.md for the definitions used here.
// This is a management view for running the business — not certified accounting or tax reporting.
import { Prisma } from "@prisma/client";
import { db } from "./db";
import { BUSINESS_TZ, type Period } from "./time";

const n = (v: unknown) => Number(v ?? 0);

/** An order is recognised as a sale on the date it first became fully paid. */
const RECOGNISED = Prisma.sql`o."paidAt" IS NOT NULL AND o.status <> 'CANCELLED'`;

export type FinancialSummary = Awaited<ReturnType<typeof financialSummary>>;

export async function financialSummary(p: Period) {
  const [sales] = await db.$queryRaw<
    { orders: bigint; product_gross: bigint; shipping: bigint; discounts: bigint; tax_inclusive: bigint; tax_all: bigint; cogs: bigint }[]
  >`
    SELECT COUNT(*) AS orders,
           COALESCE(SUM(o."listSubtotal"),0) AS product_gross,
           COALESCE(SUM(o."shippingTotal"),0) AS shipping,
           COALESCE(SUM(o."discountTotal"),0) AS discounts,
           COALESCE(SUM(CASE WHEN o."taxInclusive" THEN o."taxTotal" ELSE 0 END),0) AS tax_inclusive,
           COALESCE(SUM(o."taxTotal"),0) AS tax_all,
           COALESCE(SUM((SELECT SUM(i."unitCost" * i.quantity) FROM "OrderItem" i WHERE i."orderId" = o.id)),0) AS cogs
    FROM "Order" o
    WHERE ${RECOGNISED} AND o."paidAt" >= ${p.from} AND o."paidAt" < ${p.to}`;

  const [refunds] = await db.$queryRaw<{ amount: bigint; cogs_reversed: bigint; count: bigint }[]>`
    SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM("cogsReversed"),0) AS cogs_reversed, COUNT(*) AS count
    FROM "Refund" WHERE "createdAt" >= ${p.from} AND "createdAt" < ${p.to}`;

  const [payments] = await db.$queryRaw<{ collected: bigint; fees: bigint }[]>`
    SELECT COALESCE(SUM(amount),0) AS collected, COALESCE(SUM(fee),0) AS fees
    FROM "Payment" WHERE status = 'SUCCEEDED' AND "verifiedAt" >= ${p.from} AND "verifiedAt" < ${p.to}`;

  const expenseRows = await db.$queryRaw<{ name: string; is_operating: boolean; amount: bigint }[]>`
    SELECT c.name, c."isOperating" AS is_operating, COALESCE(SUM(e.amount),0) AS amount
    FROM "Expense" e JOIN "ExpenseCategory" c ON c.id = e."categoryId"
    WHERE e."incurredAt" >= ${p.from} AND e."incurredAt" < ${p.to}
    GROUP BY c.name, c."isOperating" ORDER BY amount DESC`;

  const [purchases] = await db.$queryRaw<{ total: bigint }[]>`
    SELECT COALESCE(SUM(total),0) AS total FROM "Purchase" WHERE "purchasedAt" >= ${p.from} AND "purchasedAt" < ${p.to}`;

  const [outstanding] = await db.$queryRaw<{ count: bigint; amount: bigint; pending_count: bigint; pending_amount: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE o."paymentStatus" IN ('UNPAID','PARTIALLY_PAID','FAILED')) AS count,
           COALESCE(SUM(o.total - o."paidTotal") FILTER (WHERE o."paymentStatus" IN ('UNPAID','PARTIALLY_PAID','FAILED')),0) AS amount,
           COUNT(*) FILTER (WHERE o."paymentStatus" = 'PENDING_VERIFICATION') AS pending_count,
           COALESCE(SUM(o.total - o."paidTotal") FILTER (WHERE o."paymentStatus" = 'PENDING_VERIFICATION'),0) AS pending_amount
    FROM "Order" o WHERE o.status <> 'CANCELLED'`;

  const productGross = n(sales.product_gross);
  const shippingCharged = n(sales.shipping);
  const grossSales = productGross + shippingCharged;
  const discounts = n(sales.discounts);
  const refundTotal = n(refunds.amount);
  const taxIncluded = n(sales.tax_inclusive);
  const netSales = grossSales - discounts - refundTotal - taxIncluded;
  const cogs = n(sales.cogs) - n(refunds.cogs_reversed);
  const grossProfit = netSales - cogs;
  const paymentFees = n(payments.fees);
  const operatingExpenseLines = expenseRows.filter((r) => r.is_operating).map((r) => ({ name: r.name, amount: n(r.amount) }));
  const otherExpenseLines = expenseRows.filter((r) => !r.is_operating).map((r) => ({ name: r.name, amount: n(r.amount) }));
  if (paymentFees > 0) operatingExpenseLines.push({ name: "Payment processing fees", amount: paymentFees });
  const operatingExpenses = operatingExpenseLines.reduce((s, r) => s + r.amount, 0);
  const otherExpenses = otherExpenseLines.reduce((s, r) => s + r.amount, 0);
  const operatingProfit = grossProfit - operatingExpenses;
  const netProfit = operatingProfit - otherExpenses;
  const orders = n(sales.orders);
  return {
    period: p,
    orders,
    productGross,
    shippingCharged,
    grossSales,
    discounts,
    refunds: refundTotal,
    refundCount: n(refunds.count),
    taxCollected: n(sales.tax_all),
    taxIncluded,
    netSales,
    cogs,
    grossProfit,
    grossMargin: netSales > 0 ? grossProfit / netSales : null,
    operatingExpenseLines,
    operatingExpenses,
    operatingProfit,
    otherExpenseLines,
    otherExpenses,
    netProfit,
    cashCollected: n(payments.collected),
    cashRefunded: refundTotal,
    netCash: n(payments.collected) - refundTotal,
    inventoryPurchases: n(purchases.total),
    averageOrderValue: orders > 0 ? Math.round((grossSales - discounts) / orders) : 0,
    unpaidOrders: n(outstanding.count),
    unpaidAmount: n(outstanding.amount),
    pendingVerificationOrders: n(outstanding.pending_count),
    pendingVerificationAmount: n(outstanding.pending_amount),
  };
}

export async function orderStatusCounts(p: Period) {
  const [placed] = await db.$queryRaw<{ count: bigint }[]>`SELECT COUNT(*) AS count FROM "Order" WHERE "placedAt" >= ${p.from} AND "placedAt" < ${p.to}`;
  const rows = await db.order.groupBy({ by: ["status"], _count: true });
  const byStatus = Object.fromEntries(rows.map((r) => [r.status, r._count])) as Record<string, number>;
  const [awaitingPayment] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*) AS count FROM "Order" WHERE status <> 'CANCELLED' AND "paymentStatus" IN ('UNPAID','PENDING_VERIFICATION','PARTIALLY_PAID','FAILED')`;
  const [periodCancelled] = await db.$queryRaw<{ cancelled: bigint; refunded: bigint }[]>`
    SELECT COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
           COUNT(*) FILTER (WHERE status IN ('REFUNDED','PARTIALLY_REFUNDED')) AS refunded
    FROM "Order" WHERE "placedAt" >= ${p.from} AND "placedAt" < ${p.to}`;
  return {
    placed: n(placed.count),
    awaitingConfirmation: byStatus.PENDING ?? 0,
    awaitingPayment: n(awaitingPayment.count),
    processing: (byStatus.CONFIRMED ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.PARTIALLY_FULFILLED ?? 0) + (byStatus.SHIPPED ?? 0) + (byStatus.READY_FOR_PICKUP ?? 0),
    completed: (byStatus.COMPLETED ?? 0) + (byStatus.DELIVERED ?? 0),
    cancelledInPeriod: n(periodCancelled.cancelled),
    refundedInPeriod: n(periodCancelled.refunded),
    byStatus,
  };
}

export type Granularity = "day" | "week" | "month";

export function pickGranularity(p: Period): Granularity {
  const days = (p.to.getTime() - p.from.getTime()) / 86400_000;
  return days <= 62 ? "day" : days <= 370 ? "week" : "month";
}

/** Sales (after discounts) and order counts per day/week/month, in Lebanon time. */
export async function salesSeries(p: Period, granularity: Granularity) {
  const unit = Prisma.raw(`'${granularity}'`);
  const tz = Prisma.raw(`'${BUSINESS_TZ}'`);
  const sales = await db.$queryRaw<{ bucket: Date; sales: bigint; orders: bigint; profit: bigint }[]>`
    SELECT date_trunc(${unit}, o."paidAt" AT TIME ZONE ${tz}) AS bucket,
           SUM(o."listSubtotal" + o."shippingTotal" - o."discountTotal" - CASE WHEN o."taxInclusive" THEN o."taxTotal" ELSE 0 END) AS sales,
           COUNT(*) AS orders,
           SUM(o."listSubtotal" + o."shippingTotal" - o."discountTotal" - CASE WHEN o."taxInclusive" THEN o."taxTotal" ELSE 0 END
               - (SELECT COALESCE(SUM(i."unitCost" * i.quantity),0) FROM "OrderItem" i WHERE i."orderId" = o.id)) AS profit
    FROM "Order" o
    WHERE ${RECOGNISED} AND o."paidAt" >= ${p.from} AND o."paidAt" < ${p.to}
    GROUP BY 1 ORDER BY 1`;
  const placed = await db.$queryRaw<{ bucket: Date; orders: bigint }[]>`
    SELECT date_trunc(${unit}, o."placedAt" AT TIME ZONE ${tz}) AS bucket, COUNT(*) AS orders
    FROM "Order" o WHERE o."placedAt" >= ${p.from} AND o."placedAt" < ${p.to} GROUP BY 1 ORDER BY 1`;
  const map = new Map<string, { bucket: string; sales: number; paidOrders: number; profit: number; placedOrders: number }>();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  for (const r of sales) map.set(key(r.bucket), { bucket: key(r.bucket), sales: n(r.sales), paidOrders: n(r.orders), profit: n(r.profit), placedOrders: 0 });
  for (const r of placed) {
    const k = key(r.bucket);
    const row = map.get(k) ?? { bucket: k, sales: 0, paidOrders: 0, profit: 0, placedOrders: 0 };
    row.placedOrders = n(r.orders);
    map.set(k, row);
  }
  // Fill empty buckets so charts show gaps as zero.
  const out: { bucket: string; sales: number; paidOrders: number; profit: number; placedOrders: number }[] = [];
  const cursor = new Date(`${p.fromYmd}T00:00:00Z`);
  if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() - ((cursor.getUTCDay() + 6) % 7));
  if (granularity === "month") cursor.setUTCDate(1);
  const end = new Date(`${p.toYmd}T00:00:00Z`);
  let guard = 0;
  while (cursor <= end && guard++ < 1000) {
    const k = cursor.toISOString().slice(0, 10);
    out.push(map.get(k) ?? { bucket: k, sales: 0, paidOrders: 0, profit: 0, placedOrders: 0 });
    if (granularity === "day") cursor.setUTCDate(cursor.getUTCDate() + 1);
    else if (granularity === "week") cursor.setUTCDate(cursor.getUTCDate() + 7);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export async function topProducts(p: Period, limit = 10) {
  const rows = await db.$queryRaw<{ product_id: string | null; title: string; quantity: bigint; revenue: bigint; cost: bigint }[]>`
    SELECT i."productId" AS product_id, MAX(i."productTitle") AS title, SUM(i.quantity - i."refundedQuantity") AS quantity,
           SUM(i."lineTotal") AS revenue, SUM(i."unitCost" * i.quantity) AS cost
    FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
    WHERE ${RECOGNISED} AND o."paidAt" >= ${p.from} AND o."paidAt" < ${p.to}
    GROUP BY i."productId" ORDER BY revenue DESC LIMIT ${limit}`;
  return rows.map((r) => ({ productId: r.product_id, title: r.title, quantity: n(r.quantity), revenue: n(r.revenue), profit: n(r.revenue) - n(r.cost) }));
}

export async function topCategories(p: Period, limit = 8) {
  const rows = await db.$queryRaw<{ name: string | null; revenue: bigint; quantity: bigint }[]>`
    SELECT COALESCE(c.name, 'Uncategorised') AS name, SUM(i."lineTotal") AS revenue, SUM(i.quantity) AS quantity
    FROM "OrderItem" i JOIN "Order" o ON o.id = i."orderId"
    LEFT JOIN "Product" pr ON pr.id = i."productId" LEFT JOIN "Category" c ON c.id = pr."categoryId"
    WHERE ${RECOGNISED} AND o."paidAt" >= ${p.from} AND o."paidAt" < ${p.to}
    GROUP BY 1 ORDER BY revenue DESC LIMIT ${limit}`;
  return rows.map((r) => ({ name: r.name ?? "Uncategorised", revenue: n(r.revenue), quantity: n(r.quantity) }));
}

export async function paymentMethodBreakdown(p: Period) {
  const rows = await db.$queryRaw<{ name: string; amount: bigint; count: bigint }[]>`
    SELECT "methodName" AS name, SUM(amount) AS amount, COUNT(*) AS count
    FROM "Payment" WHERE status = 'SUCCEEDED' AND "verifiedAt" >= ${p.from} AND "verifiedAt" < ${p.to}
    GROUP BY 1 ORDER BY amount DESC`;
  return rows.map((r) => ({ name: r.name, amount: n(r.amount), count: n(r.count) }));
}

export async function lowStockVariants(limit = 10) {
  return db.$queryRaw<{ id: string; sku: string; name: string; title: string; product_id: string; stock: number; threshold: number }[]>`
    SELECT v.id, v.sku, v.name, p.title, p.id AS product_id, v."stockOnHand" AS stock, v."lowStockThreshold" AS threshold
    FROM "ProductVariant" v JOIN "Product" p ON p.id = v."productId"
    WHERE v."trackInventory" AND v."isActive" AND v."deletedAt" IS NULL AND p."deletedAt" IS NULL AND p.status <> 'ARCHIVED'
      AND v."stockOnHand" <= v."lowStockThreshold"
    ORDER BY v."stockOnHand" ASC LIMIT ${limit}`;
}
