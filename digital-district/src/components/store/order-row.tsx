import Link from "next/link";
import type { Order } from "@prisma/client";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { Badge } from "../ui";

export function OrderRow({ order, itemCount }: { order: Order; itemCount: number }) {
  return (
    <Link href={`/order/${order.number}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 transition hover:border-brand-500/40">
      <div>
        <p className="font-mono font-semibold text-white">{order.number}</p>
        <p className="text-xs text-subtle">{order.placedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {itemCount} item{itemCount === 1 ? "" : "s"}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
        <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
        <span className="ml-1 font-semibold text-white">{formatMoney(order.total, order.currency)}</span>
      </div>
    </Link>
  );
}
