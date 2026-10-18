import type { Metadata } from "next";
import { Download } from "lucide-react";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { resolvePeriod, type PeriodPreset } from "@/lib/time";
import { financialSummary, paymentMethodBreakdown, pickGranularity, salesSeries, topCategories, topProducts } from "@/lib/reports";
import { PageHeader, Panel, Stat } from "@/components/admin/ui";
import { PeriodPicker } from "@/components/admin/period-picker";
import { BreakdownChart, SalesChart } from "@/components/admin/charts";
import { Alert, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Reports & profit" };

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ period?: PeriodPreset; from?: string; to?: string }> }) {
  await requireStaffPage("finance.view");
  const sp = await searchParams;
  const p = resolvePeriod(sp.period ?? "month", sp.from, sp.to);
  const [s, series, products, categories, methods] = await Promise.all([financialSummary(p), salesSeries(p, pickGranularity(p)), topProducts(p, 15), topCategories(p, 10), paymentMethodBreakdown(p)]);
  const m = (c: number) => formatMoney(c);
  const qs = `period=${p.preset}${p.preset === "custom" ? `&from=${p.fromYmd}&to=${p.toYmd}` : ""}`;
  const line = (label: string, amount: number, opts: { strong?: boolean; indent?: boolean; negative?: boolean; hint?: string } = {}) => (
    <tr className={opts.strong ? "border-t border-line font-semibold text-white" : ""}>
      <td className={`py-2 ${opts.indent ? "pl-6 text-muted" : ""}`}>{label}{opts.hint && <span className="block text-xs font-normal text-subtle">{opts.hint}</span>}</td>
      <td className={`py-2 text-right tabular-nums ${amount < 0 && opts.strong ? "text-danger" : ""}`}>{opts.negative && amount > 0 ? `−${m(amount)}` : m(amount)}</td>
    </tr>
  );
  return (
    <div>
      <PageHeader
        title="Reports & profit"
        description={`${p.label} (${p.fromYmd} → ${p.toYmd}, Lebanon time)`}
        actions={
          <>
            <PeriodPicker period={p} basePath="/admin/reports" />
            <a href={`/api/admin/export/summary?${qs}`} className={buttonClass("secondary", "sm")}><Download className="size-4" /> P&amp;L CSV</a>
            <a href={`/api/admin/export/expenses?${qs}`} className={buttonClass("ghost", "sm")}><Download className="size-4" /> Expenses CSV</a>
          </>
        }
      />
      <Alert tone="info" className="mb-6" title="Management accounting view">
        These figures help you run the business. They are estimates based on what is recorded in the store — not certified accounting or tax reporting. A sale counts on the day the order became fully paid; unpaid, unverified and cancelled orders are never counted as revenue.
      </Alert>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Net sales" value={m(s.netSales)} hint={`${s.orders} paid orders`} />
        <Stat label="Gross profit" value={m(s.grossProfit)} hint={s.grossMargin != null ? `${(s.grossMargin * 100).toFixed(1)}% margin` : undefined} tone={s.grossProfit < 0 ? "bad" : undefined} />
        <Stat label="Net profit (estimate)" value={m(s.netProfit)} tone={s.netProfit < 0 ? "bad" : "good"} />
        <Stat label="Net cash in" value={m(s.netCash)} hint="Payments received − refunds" />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Profit & loss">
          <table className="w-full text-sm">
            <tbody>
              {line("Gross sales", s.grossSales, { hint: "Products at their regular price + delivery fees charged" })}
              {line("Delivery fees included above", s.shippingCharged, { indent: true })}
              {line("Discounts (sales & coupons)", s.discounts, { negative: true })}
              {line("Refunds", s.refunds, { negative: true, hint: `${s.refundCount} refund(s) recorded in this period` })}
              {s.taxIncluded > 0 && line("Tax included in prices", s.taxIncluded, { negative: true, hint: "Collected on behalf of the government — not your revenue" })}
              {line("Net sales", s.netSales, { strong: true })}
              {line("Cost of goods sold", s.cogs, { negative: true, hint: "Cost price recorded on each item when it was ordered, less items returned to stock" })}
              {line("Gross profit", s.grossProfit, { strong: true })}
              {s.operatingExpenseLines.map((l) => <tr key={l.name}><td className="py-1.5 pl-6 text-muted">{l.name}</td><td className="py-1.5 text-right tabular-nums">−{m(l.amount)}</td></tr>)}
              {line("Operating expenses", s.operatingExpenses, { negative: true })}
              {line("Operating profit (estimate)", s.operatingProfit, { strong: true })}
              {s.otherExpenseLines.map((l) => <tr key={l.name}><td className="py-1.5 pl-6 text-muted">{l.name}</td><td className="py-1.5 text-right tabular-nums">−{m(l.amount)}</td></tr>)}
              {s.otherExpenses > 0 && line("Other expenses", s.otherExpenses, { negative: true })}
              {line("Net profit (estimate)", s.netProfit, { strong: true })}
            </tbody>
          </table>
        </Panel>
        <div className="space-y-6">
          <Panel title="Cash & balances">
            <table className="w-full text-sm">
              <tbody>
                {line("Cash collected", s.cashCollected, { hint: "Payments verified in this period" })}
                {line("Cash refunded", s.cashRefunded, { negative: true })}
                {line("Net cash in", s.netCash, { strong: true })}
                {line("Tax collected", s.taxCollected, { hint: "Included in or added to customer totals" })}
                {line("Inventory purchases", s.inventoryPurchases, { hint: "Stock bought — becomes cost of goods sold when items sell" })}
                {line("Unpaid balance on open orders", s.unpaidAmount, { hint: `${s.unpaidOrders} order(s), all dates — not revenue until paid` })}
                {line("Payments awaiting verification", s.pendingVerificationAmount, { hint: `${s.pendingVerificationOrders} order(s)` })}
              </tbody>
            </table>
          </Panel>
          <Panel title="Payment methods (cash collected)"><BreakdownChart data={methods.map((x) => ({ name: x.name, amount: x.amount }))} /></Panel>
        </div>
      </div>
      <Panel title="Sales and gross profit over time" className="mt-6"><SalesChart data={series} /></Panel>
      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Product performance" bodyClassName="p-0">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wider text-subtle"><tr className="border-b border-line"><th className="px-5 py-2.5">Product</th><th className="px-3 py-2.5 text-right">Units</th><th className="px-3 py-2.5 text-right">Revenue</th><th className="px-3 py-2.5 text-right">Profit</th><th className="px-5 py-2.5 text-right">Margin</th></tr></thead>
            <tbody>
              {products.map((x) => (
                <tr key={x.productId ?? x.title} className="border-b border-line/60 last:border-0">
                  <td className="px-5 py-2">{x.title}</td><td className="px-3 py-2 text-right">{x.quantity}</td><td className="px-3 py-2 text-right">{m(x.revenue)}</td>
                  <td className={`px-3 py-2 text-right ${x.profit < 0 ? "text-danger" : "text-success"}`}>{m(x.profit)}</td>
                  <td className="px-5 py-2 text-right text-muted">{x.revenue ? `${Math.round((x.profit / x.revenue) * 100)}%` : "—"}</td>
                </tr>
              ))}
              {!products.length && <tr><td colSpan={5} className="px-5 py-8 text-center text-subtle">No paid orders in this period.</td></tr>}
            </tbody>
          </table>
        </Panel>
        <Panel title="Categories"><BreakdownChart data={categories.map((c) => ({ name: c.name, amount: c.revenue }))} /></Panel>
      </div>
    </div>
  );
}
