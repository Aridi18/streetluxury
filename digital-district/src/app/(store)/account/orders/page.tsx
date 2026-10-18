import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { reorderAction } from "@/app/actions/account";
import { submitReviewAction } from "@/app/actions/engagement";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, EmptyState, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Orders" };

export default async function AccountOrders({ searchParams }: { searchParams: Promise<{ review?: string }> }) {
  const user = await requireUser("/account/orders");
  const { review } = await searchParams;
  const orders = await db.order.findMany({ where: { userId: user.id }, orderBy: { placedAt: "desc" }, include: { items: { include: { reviews: { select: { id: true } } } } } });
  if (!orders.length) return <EmptyState title="No orders yet" action={<LinkButton href="/shop">Start shopping</LinkButton>}>Orders you place while signed in — and guest orders made with your email — appear here.</EmptyState>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Your orders</h2>
      {orders.map((o) => {
        const delivered = ["DELIVERED", "COMPLETED"].includes(o.status);
        return (
          <article key={o.id} className="card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Link href={`/order/${o.number}`} className="font-mono text-lg font-semibold text-white hover:text-brand-200">{o.number}</Link>
                <p className="text-xs text-subtle">{o.placedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge>
                <Badge tone={PAYMENT_STATUS_TONE[o.paymentStatus]}>{PAYMENT_STATUS_LABELS[o.paymentStatus]}</Badge>
              </div>
            </div>
            <ul className="mt-4 divide-y divide-line text-sm">
              {o.items.map((i) => (
                <li key={i.id} className="py-2.5">
                  <div className="flex justify-between gap-3">
                    <span>{i.productTitle}{i.variantName !== "Default" ? ` — ${i.variantName}` : ""} × {i.quantity}</span>
                    <span className="text-muted">{formatMoney(i.lineTotal, o.currency)}</span>
                  </div>
                  {delivered && i.productId && i.reviews.length === 0 && (
                    <details className="mt-2" open={review === i.id}>
                      <summary className="cursor-pointer text-xs font-semibold text-brand-300">Write a review</summary>
                      <ActionForm action={submitReviewAction} submitLabel="Submit review" hideOnSuccess className="mt-3 max-w-lg">
                        <input type="hidden" name="orderItemId" value={i.id} />
                        <Field label="Rating" htmlFor={`r-${i.id}`}>
                          <Select id={`r-${i.id}`} name="rating" required defaultValue="">
                            <option value="" disabled>Choose…</option>
                            {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{"★".repeat(n)} ({n})</option>)}
                          </Select>
                        </Field>
                        <Field label="Title (optional)" htmlFor={`t-${i.id}`}><Input id={`t-${i.id}`} name="title" maxLength={120} /></Field>
                        <Field label="Your review" htmlFor={`b-${i.id}`}><Textarea id={`b-${i.id}`} name="body" required minLength={10} maxLength={3000} /></Field>
                      </ActionForm>
                    </details>
                  )}
                  {i.reviews.length > 0 && <p className="mt-1 text-xs text-subtle">Reviewed — thank you</p>}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
              <span className="font-semibold">{formatMoney(o.total, o.currency)}</span>
              <div className="flex gap-2">
                <LinkButton href={`/order/${o.number}`} variant="outline" size="sm">Details</LinkButton>
                <form action={reorderAction}><input type="hidden" name="orderId" value={o.id} /><Button size="sm" variant="secondary">Order again</Button></form>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
