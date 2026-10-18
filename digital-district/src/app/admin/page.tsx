import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatMoney } from "@/lib/money";
import { resolvePeriod, type PeriodPreset } from "@/lib/time";
import { financialSummary, lowStockVariants, orderStatusCounts, paymentMethodBreakdown, pickGranularity, salesSeries, topCategories, topProducts } from "@/lib/reports";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { PageHeader, Panel, Stat, Table, fmtDateTime } from "@/components/admin/ui";
import { PeriodPicker } from "@/components/admin/period-picker";
import { BreakdownChart, OrdersChart, SalesChart } from "@/components/admin/charts";
import { Alert, Badge } from "@/components/ui";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: PeriodPreset; from?: string; to?: string; forbidden?: string }> }) {
  const user = await requireStaffPage("dashboard.view");
  const sp = await searchParams;
  const period = resolvePeriod(sp.period ?? "30d", sp.from, sp.to);
  const finance = hasPermission(user.role, "finance.view");
  const m = (c: number) => formatMoney(c);
  const [counts, series, products, categories, methods, lowStock, pendingDeliveries, recent, activity, missingCost, summary] = await Promise.all([
    orderStatusCounts(period),
    salesSeries(period, pickGranularity(period)),
    finance ? topProducts(period, 8) : Promise.resolve([]),
    finance ? topCategories(period, 6) : Promise.resolve([]),
    finance ? paymentMethodBreakdown(period) : Promise.resolve([]),
    lowStockVariants(8),
    db.digitalDelivery.findMany({ where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] }, order: { status: { not: "CANCELLED" }, paymentStatus: { in: ["PAID", "PARTIALLY_REFUNDED"] } } }, include: { order: true, orderItem: true }, orderBy: { createdAt: "asc" }, take: 8 }),
    db.order.findMany({ orderBy: { placedAt: "desc" }, take: 8 }),
    hasPermission(user.role, "audit.view") ? db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 8 }) : Promise.resolve([]),
    finance ? db.productVariant.count({ where: { costPrice: 0, isActive: true, deletedAt: null, product: { status: "ACTIVE", isOnRequest: false } } }) : Promise.resolve(0),
    finance ? financialSummary(period) : Promise.resolve(null),
  ]);

  return (
    <div>
      <PageHeader title="Dashboard" description={`${period.label} · figures come directly from your orders, payments and expenses.`} actions={<PeriodPicker period={period} basePath="/admin" />} />
      {sp.forbidden && <Alert tone="warning" className="mb-6">Your role doesn&apos;t have access to that page.</Alert>}

      {summary && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Net sales" value={m(summary.netSales)} hint={`${summary.orders} paid order${summary.orders === 1 ? "" : "s"}`} />
            <Stat label="Gross profit" value={m(summary.grossProfit)} hint={summary.grossMargin != null ? `${Math.round(summary.grossMargin * 100)}% margin` : "—"} tone={summary.grossProfit < 0 ? "bad" : undefined} />
            <Stat label="Net profit (estimate)" value={m(summary.netProfit)} hint="After recorded expenses" tone={summary.netProfit < 0 ? "bad" : "good"} />
            <Stat label="Cash collected" value={m(summary.cashCollected)} hint={summary.refunds ? `${m(summary.refunds)} refunded` : "Verified payments"} />
            <Stat label="Average order" value={m(summary.averageOrderValue)} />
            <Stat label="Unpaid balance" value={m(summary.unpaidAmount)} hint={`${summary.unpaidOrders} open order${summary.unpaidOrders === 1 ? "" : "s"}`} tone={summary.unpaidAmount ? "warn" : undefined} />
          </div>
          {missingCost > 0 && (
            <Alert tone="warning" className="mt-4" title={`${missingCost} active product option${missingCost === 1 ? " has" : "s have"} no cost price`}>
              Profit for those items is overstated until you add their cost. <Link href="/admin/products?missingCost=1" className="underline">Add cost prices</Link>
            </Alert>
          )}
        </>
      )}

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <PipelineStat href="/admin/orders" label="Orders received" value={counts.placed} hint={period.label} />
        <PipelineStat href="/admin/orders?status=PENDING" label="Awaiting confirmation" value={counts.awaitingConfirmation} warn />
        <PipelineStat href="/admin/orders?payment=open" label="Awaiting payment" value={counts.awaitingPayment} warn />
        <PipelineStat href="/admin/orders?status=open" label="Processing" value={counts.processing} />
        <PipelineStat href="/admin/orders?status=COMPLETED" label="Completed / delivered" value={counts.completed} />
        <PipelineStat href="/admin/orders?status=CANCELLED" label="Cancelled · refunded" value={`${counts.cancelledInPeriod} · ${counts.refundedInPeriod}`} hint={period.label} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {finance && (
          <Panel title="Sales trend" className="xl:col-span-2" actions={<span className="text-xs text-subtle">Sales after discounts (purple) and gross profit (green), by payment date</span>}>
            <SalesChart data={series} />
          </Panel>
        )}
        <Panel title="Order volume" className={finance ? "" : "xl:col-span-3"} actions={<span className="text-xs text-subtle">Placed vs paid</span>}>
          <OrdersChart data={series} />
        </Panel>
      </div>

      {finance && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Panel title="Bestselling products" className="lg:col-span-2" bodyClassName="p-0">
            {products.length ? (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wider text-subtle"><tr className="border-b border-line"><th className="px-5 py-2.5">Product</th><th className="px-3 py-2.5 text-right">Units</th><th className="px-3 py-2.5 text-right">Revenue</th><th className="px-5 py-2.5 text-right">Profit</th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.productId ?? p.title} className="border-b border-line/60 last:border-0">
                      <td className="px-5 py-2.5">{p.productId ? <Link href={`/admin/products/${p.productId}`} className="hover:text-brand-200">{p.title}</Link> : p.title}</td>
                      <td className="px-3 py-2.5 text-right">{p.quantity}</td>
                      <td className="px-3 py-2.5 text-right">{m(p.revenue)}</td>
                      <td className={`px-5 py-2.5 text-right ${p.profit < 0 ? "text-danger" : "text-success"}`}>{m(p.profit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <p className="p-5 text-sm text-subtle">No paid orders in this period yet.</p>}
          </Panel>
          <Panel title="Payment methods"><BreakdownChart data={methods.map((x) => ({ name: x.name, amount: x.amount }))} /></Panel>
          <Panel title="Top categories" className="lg:col-span-3"><BreakdownChart data={categories.map((c) => ({ name: c.name, amount: c.revenue }))} /></Panel>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Pending digital deliveries" actions={<Link href="/admin/orders?delivery=pending" className="text-xs text-brand-300">View all</Link>} bodyClassName="p-0">
          {pendingDeliveries.length ? (
            <ul className="divide-y divide-line text-sm">
              {pendingDeliveries.map((d) => (
                <li key={d.id}>
                  <Link href={`/admin/orders/${d.orderId}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                    <span><span className="font-mono text-xs text-subtle">{d.order.number}</span> {d.orderItem.productTitle}</span>
                    <Badge tone={d.status === "FAILED" ? "danger" : "warning"}>{d.status.toLowerCase()}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="p-5 text-sm text-subtle">All paid digital items are delivered.</p>}
        </Panel>
        <Panel title="Low stock" actions={<Link href="/admin/inventory?low=1" className="text-xs text-brand-300">Inventory</Link>} bodyClassName="p-0">
          {lowStock.length ? (
            <ul className="divide-y divide-line text-sm">
              {lowStock.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span><span className="font-mono text-xs text-subtle">{v.sku}</span> {v.title}{v.name !== "Default" ? ` — ${v.name}` : ""}</span>
                  <span className={v.stock <= 0 ? "font-semibold text-danger" : "font-semibold text-warning"}>{v.stock} left</span>
                </li>
              ))}
            </ul>
          ) : <p className="p-5 text-sm text-subtle">No tracked products are running low.</p>}
        </Panel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <h2 className="mb-3 font-semibold">Recent orders</h2>
          <Table>
            <thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>Payment</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {recent.map((o) => (
                <tr key={o.id}>
                  <td><Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-white hover:text-brand-200">{o.number}</Link><p className="text-xs text-subtle">{fmtDateTime(o.placedAt)}{o.source === "WHATSAPP" ? " · WhatsApp" : ""}</p></td>
                  <td>{o.customerName}</td>
                  <td><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
                  <td><Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge></td>
                  <td className="text-right font-semibold">{m(o.total)}</td>
                </tr>
              ))}
              {!recent.length && <tr><td colSpan={5} className="text-center text-subtle">No orders yet.</td></tr>}
            </tbody>
          </Table>
        </div>
        {activity.length > 0 && (
          <Panel title="Recent activity" bodyClassName="p-0">
            <ul className="divide-y divide-line text-sm">
              {activity.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <p className="text-fg/90">{a.summary ?? a.action}</p>
                  <p className="text-xs text-subtle">{a.actorName} · {fmtDateTime(a.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
      {summary && <p className="mt-8 flex items-start gap-2 text-xs text-subtle"><AlertTriangle className="size-4 shrink-0" /> Management accounting view for running the business — not certified accounting or tax reporting. See Reports for the definitions used.</p>}
    </div>
  );
}

function PipelineStat({ href, label, value, hint, warn }: { href: string; label: string; value: number | string; hint?: string; warn?: boolean }) {
  return (
    <Link href={href} className="rounded-2xl border border-line bg-surface p-4 transition hover:border-brand-500/40">
      <p className="text-xs text-subtle">{label}</p>
      <p className={`mt-1 font-display text-xl font-semibold ${warn && Number(value) > 0 ? "text-warning" : "text-white"}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-subtle">{hint}</p>}
    </Link>
  );
}
