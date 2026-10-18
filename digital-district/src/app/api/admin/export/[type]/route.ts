import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cents, csvResponse, toCsv } from "@/lib/csv";
import { orderWhere } from "@/lib/admin-queries";
import { financialSummary } from "@/lib/reports";
import { resolvePeriod, type PeriodPreset } from "@/lib/time";
import type { Permission } from "@/lib/permissions";

const PERMS: Record<string, Permission> = {
  orders: "orders.view",
  products: "products.manage",
  expenses: "expenses.manage",
  customers: "customers.export",
  newsletter: "customers.export",
  summary: "finance.view",
  inventory: "inventory.manage",
};

/** CSV exports. Every export is permission-checked and recorded in the audit log. */
export async function GET(request: Request, { params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  const perm = PERMS[type];
  if (!perm) return new Response("Not found", { status: 404 });
  let user;
  try {
    user = await requireStaff(perm);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
  const sp = Object.fromEntries(new URL(request.url).searchParams);
  const stamp = new Date().toISOString().slice(0, 10);
  let csv = "";

  if (type === "orders") {
    const orders = await db.order.findMany({ where: orderWhere(sp), orderBy: { placedAt: "desc" }, include: { items: true }, take: 20000 });
    csv = toCsv(orders.map((o) => ({
      number: o.number, placed_at: o.placedAt, source: o.source, status: o.status, payment_status: o.paymentStatus, customer: o.customerName, phone: `+${o.phone}`, email: o.email,
      items: o.items.map((i) => `${i.quantity}x ${i.productTitle}${i.variantName !== "Default" ? ` (${i.variantName})` : ""}`).join("; "),
      list_subtotal: cents(o.listSubtotal), discounts: cents(o.discountTotal), coupon: o.couponCode, shipping: cents(o.shippingTotal), tax: cents(o.taxTotal), total: cents(o.total),
      paid: cents(o.paidTotal), refunded: cents(o.refundedTotal), cost_of_goods: cents(o.items.reduce((s, i) => s + i.unitCost * i.quantity, 0)),
      payment_method: o.paymentMethodName, paid_at: o.paidAt, delivery: o.deliveryMethod, city: o.shipCity, area: o.shipArea, address: o.shipAddress, currency: o.currency,
    })));
  } else if (type === "products") {
    const products = await db.product.findMany({ where: { deletedAt: null }, include: { variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }, category: true, brand: true, tags: { include: { tag: true } } }, orderBy: { title: "asc" } });
    csv = toCsv(products.flatMap((p) => (p.variants.length ? p.variants : [null]).map((v) => ({
      product_slug: p.slug, title: p.title, type: p.type, status: p.status, category: p.category?.slug ?? "", brand: p.brand?.name ?? "", tags: p.tags.map((t) => t.tag.name).join("|"),
      short_description: p.shortDescription, description: p.description, badge: p.badge, featured: p.isFeatured ? "yes" : "no", on_request: p.isOnRequest ? "yes" : "no",
      variant_name: v?.name ?? "", option_values: v ? Object.entries((v.optionValues ?? {}) as Record<string, string>).map(([k, val]) => `${k}=${val}`).join("|") : "",
      sku: v?.sku ?? "", price: cents(v?.price), compare_at_price: cents(v?.compareAtPrice), cost_price: cents(v?.costPrice), track_inventory: v ? (v.trackInventory ? "yes" : "no") : "",
      stock: v?.stockOnHand ?? "", duration_days: v?.durationDays ?? "", active: v ? (v.isActive ? "yes" : "no") : "",
    }))));
  } else if (type === "inventory") {
    const variants = await db.productVariant.findMany({ where: { deletedAt: null, trackInventory: true }, include: { product: true }, orderBy: { sku: "asc" } });
    csv = toCsv(variants.map((v) => ({ sku: v.sku, product: v.product.title, variant: v.name, stock: v.stockOnHand, low_stock_threshold: v.lowStockThreshold, cost_price: cents(v.costPrice), stock_value_at_cost: cents(Math.max(0, v.stockOnHand) * v.costPrice) })));
  } else if (type === "expenses") {
    const p = resolvePeriod((sp.period as PeriodPreset) ?? "year", sp.from, sp.to);
    const rows = await db.expense.findMany({ where: { incurredAt: { gte: p.from, lt: p.to } }, include: { category: true }, orderBy: { incurredAt: "desc" } });
    csv = toCsv(rows.map((e) => ({ date: e.incurredAt.toISOString().slice(0, 10), category: e.category.name, type: e.category.isOperating ? "operating" : "other", description: e.description, vendor: e.vendor, amount: cents(e.amount) })));
  } else if (type === "customers") {
    const users = await db.user.findMany({ where: { role: "CUSTOMER", deletedAt: null }, include: { _count: { select: { orders: true } } }, orderBy: { createdAt: "desc" } });
    csv = toCsv(users.map((u) => ({ name: u.name, email: u.email, phone: u.phone ? `+${u.phone}` : "", orders: u._count.orders, marketing_opt_in: u.marketingOptIn ? "yes" : "no", tags: u.customerTags.join("|"), joined: u.createdAt })));
  } else if (type === "newsletter") {
    const subs = await db.newsletterSubscriber.findMany({ where: { unsubscribedAt: null }, orderBy: { createdAt: "desc" } });
    csv = toCsv(subs.map((s) => ({ email: s.email, consent_at: s.consentAt, consent_text: s.consentText })));
  } else if (type === "summary") {
    const s = await financialSummary(resolvePeriod((sp.period as PeriodPreset) ?? "30d", sp.from, sp.to));
    const lines: [string, number][] = [
      ["Gross sales (products at list price + delivery fees)", s.grossSales], ["  of which delivery fees charged", s.shippingCharged], ["Discounts", -s.discounts], ["Refunds", -s.refunds],
      ["Tax included in prices", -s.taxIncluded], ["Net sales", s.netSales], ["Cost of goods sold", -s.cogs], ["Gross profit", s.grossProfit],
      ...s.operatingExpenseLines.map((l) => [`  ${l.name}`, -l.amount] as [string, number]), ["Operating expenses", -s.operatingExpenses], ["Operating profit (estimate)", s.operatingProfit],
      ...s.otherExpenseLines.map((l) => [`  ${l.name}`, -l.amount] as [string, number]), ["Other expenses", -s.otherExpenses], ["Net profit (estimate)", s.netProfit],
      ["Cash collected (verified payments)", s.cashCollected], ["Cash refunded", -s.cashRefunded], ["Net cash", s.netCash], ["Tax collected", s.taxCollected],
      ["Inventory purchases (not an expense; becomes cost of goods when sold)", s.inventoryPurchases], ["Unpaid balance on open orders (all dates)", s.unpaidAmount],
    ];
    csv = toCsv(lines.map(([line, amount]) => ({ line, amount_usd: cents(amount) })), ["line", "amount_usd"]);
    csv = `Period,${s.period.fromYmd} to ${s.period.toYmd}\nBasis,Management accounting estimate (not certified accounting or tax reporting)\n\n${csv}`;
  }
  await audit(user, "export.csv", "Export", type, `Exported ${type} CSV`);
  return csvResponse(csv, `digital-district-${type}-${stamp}.csv`);
}
