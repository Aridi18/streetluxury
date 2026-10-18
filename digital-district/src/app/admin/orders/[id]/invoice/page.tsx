import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { publicFileUrl } from "@/lib/media";
import { PAYMENT_STATUS_LABELS } from "@/lib/order-status";
import { PrintButton } from "@/components/admin/print-button";

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("orders.view");
  const order = await db.order.findUnique({ where: { id: (await params).id }, include: { items: true } });
  if (!order) notFound();
  const s = await getSettings();
  const m = (c: number) => formatMoney(c, order.currency);
  const logo = publicFileUrl(s.logoKey);
  return (
    <div className="mx-auto max-w-3xl rounded-2xl bg-white p-10 text-[13px] text-neutral-800 print:max-w-none print:rounded-none print:p-0">
      <div className="mb-6 flex justify-end print:hidden"><PrintButton /></div>
      <div className="flex items-start justify-between gap-6 border-b border-neutral-200 pb-6">
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {logo ? <img src={logo} alt={s.storeName} className="mb-2 h-14 w-auto" /> : <p className="text-lg font-bold tracking-[0.2em] text-neutral-900">DIGITAL DISTRICT</p>}
          <p>{s.address}</p>
          <p>{s.phoneDisplay}{s.supportEmail ? ` · ${s.supportEmail}` : ""}</p>
          <p>{s.domain}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-neutral-900">Invoice</p>
          <p className="font-mono">{order.number}</p>
          <p>{order.placedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Beirut" })}</p>
          <p className="mt-1 font-semibold">{PAYMENT_STATUS_LABELS[order.paymentStatus]}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6 py-6">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Bill to</p>
          <p className="font-semibold">{order.customerName}</p>
          <p>{formatPhone(order.phone)}</p>
          {order.email && <p>{order.email}</p>}
        </div>
        {order.requiresShipping && order.deliveryMethod === "DELIVERY" && (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-neutral-500">Deliver to</p>
            <p>{order.shipAddress}</p>
            <p>{[order.shipArea, order.shipCity].filter(Boolean).join(", ")}</p>
          </div>
        )}
      </div>
      <table className="w-full">
        <thead><tr className="border-b border-neutral-300 text-left text-xs uppercase text-neutral-500"><th className="py-2">Item</th><th className="py-2 text-right">Qty</th><th className="py-2 text-right">Unit price</th><th className="py-2 text-right">Amount</th></tr></thead>
        <tbody>
          {order.items.map((i) => (
            <tr key={i.id} className="border-b border-neutral-100">
              <td className="py-2">{i.productTitle}{i.variantName !== "Default" ? ` — ${i.variantName}` : ""}<span className="block text-xs text-neutral-500">SKU {i.sku}</span></td>
              <td className="py-2 text-right">{i.quantity}</td>
              <td className="py-2 text-right">{m(i.unitPrice)}</td>
              <td className="py-2 text-right">{m(i.unitPrice * i.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 w-64 space-y-1">
        <div className="flex justify-between"><dt>Subtotal</dt><dd>{m(order.subtotal)}</dd></div>
        {order.couponDiscount > 0 && <div className="flex justify-between"><dt>Discount{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd>−{m(order.couponDiscount)}</dd></div>}
        {order.requiresShipping && <div className="flex justify-between"><dt>Delivery</dt><dd>{m(order.shippingTotal)}</dd></div>}
        {order.taxTotal > 0 && <div className="flex justify-between"><dt>{order.taxInclusive ? `Includes ${s.taxName}` : s.taxName}</dt><dd>{m(order.taxTotal)}</dd></div>}
        <div className="flex justify-between border-t border-neutral-300 pt-1 text-base font-bold"><dt>Total</dt><dd>{m(order.total)}</dd></div>
        <div className="flex justify-between"><dt>Paid</dt><dd>{m(order.paidTotal)}</dd></div>
        {order.refundedTotal > 0 && <div className="flex justify-between"><dt>Refunded</dt><dd>{m(order.refundedTotal)}</dd></div>}
      </dl>
      <p className="mt-10 text-center text-xs text-neutral-500">Thank you for shopping with {s.storeName}. {s.tagline}</p>
    </div>
  );
}
