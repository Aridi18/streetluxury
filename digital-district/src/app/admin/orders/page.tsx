import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { orderWhere, type OrderFilters } from "@/lib/admin-queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { PageHeader, Pagination, Table, fmtDateTime } from "@/components/admin/ui";
import { Badge, Button, Input, LinkButton, buttonClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/store/icons";

export const metadata: Metadata = { title: "Orders" };
const PAGE = 30;

export default async function OrdersPage({ searchParams }: { searchParams: Promise<OrderFilters & { page?: string }> }) {
  await requireStaffPage("orders.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = orderWhere(sp);
  const [orders, total] = await Promise.all([
    db.order.findMany({ where, orderBy: { placedAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE, include: { _count: { select: { items: true } } } }),
    db.order.count({ where }),
  ]);
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...extra })) if (v) p.set(k, String(v));
    return p.toString();
  };
  const sel = "h-10 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm";
  return (
    <div>
      <PageHeader
        title="Orders"
        description="Search by order number, customer, phone, email, product or SKU."
        actions={<a href={`/api/admin/export/orders?${qs({ page: undefined })}`} className={buttonClass("secondary", "sm")}><Download className="size-4" /> Export CSV</a>}
      />
      <form method="get" className="mb-4 grid gap-2 rounded-2xl border border-line bg-surface p-3 md:grid-cols-4 xl:grid-cols-8">
        <Input name="q" defaultValue={sp.q} placeholder="Search…" className="h-10 md:col-span-2" />
        <select name="status" defaultValue={sp.status ?? ""} className={sel} aria-label="Order status">
          <option value="">All statuses</option>
          <option value="open">Open (confirmed → shipped)</option>
          {Object.entries(ORDER_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="payment" defaultValue={sp.payment ?? ""} className={sel} aria-label="Payment status">
          <option value="">All payments</option>
          <option value="open">Not yet paid</option>
          {Object.entries(PAYMENT_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select name="source" defaultValue={sp.source ?? ""} className={sel} aria-label="Source">
          <option value="">All sources</option><option value="WEBSITE">Website</option><option value="WHATSAPP">WhatsApp</option><option value="ADMIN">Admin</option>
        </select>
        <select name="type" defaultValue={sp.type ?? ""} className={sel} aria-label="Fulfilment type">
          <option value="">All fulfilment</option><option value="physical">Physical delivery</option><option value="digital">Digital items</option>
        </select>
        <div className="flex gap-1 md:col-span-2 xl:col-span-1">
          <input type="date" name="from" defaultValue={sp.from} aria-label="From date" className={`${sel} w-full [color-scheme:dark]`} />
          <input type="date" name="to" defaultValue={sp.to} aria-label="To date" className={`${sel} w-full [color-scheme:dark]`} />
        </div>
        <div className="flex gap-2 xl:col-span-8 xl:justify-end">
          {sp.delivery && <input type="hidden" name="delivery" value={sp.delivery} />}
          <Button size="sm" className="h-10">Filter</Button>
          <LinkButton href="/admin/orders" size="sm" variant="ghost" className="h-10">Reset</LinkButton>
        </div>
      </form>
      <Table>
        <thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Status</th><th>Payment</th><th className="text-right">Total</th><th></th></tr></thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-white hover:text-brand-200">{o.number}</Link>
                <p className="text-xs text-subtle">{fmtDateTime(o.placedAt)}</p>
              </td>
              <td><p>{o.customerName}</p><p className="text-xs text-subtle">{formatPhone(o.phone)}</p></td>
              <td className="text-muted">{o._count.items} · {o.source === "WHATSAPP" ? "WhatsApp" : o.source === "ADMIN" ? "Admin" : "Web"}{o.requiresShipping ? " · Physical" : ""}</td>
              <td><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td>
              <td><Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge></td>
              <td className="text-right font-semibold">{formatMoney(o.total, o.currency)}</td>
              <td className="text-right">
                <a href={`https://wa.me/${o.phone}?text=${encodeURIComponent(`Hello ${o.customerName}, this is Digital District about your order ${o.number}.`)}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${o.customerName}`} className="inline-grid size-8 place-items-center rounded-lg text-[#25D366] hover:bg-surface-3"><WhatsAppIcon className="size-4" /></a>
              </td>
            </tr>
          ))}
          {!orders.length && <tr><td colSpan={7} className="py-10 text-center text-subtle">No orders match these filters.</td></tr>}
        </tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE} href={(p) => `/admin/orders?${qs({ page: String(p) })}`} />
    </div>
  );
}
