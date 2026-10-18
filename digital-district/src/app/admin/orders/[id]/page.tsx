import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Printer } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatMoney, centsToInput } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { orderUrl } from "@/lib/order-core";
import { allowedTransitions, CANCELLABLE, ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { readDeliveryContent, revealLicenseKeys } from "@/lib/fulfillment";
import { waLink } from "@/lib/whatsapp";
import {
  addNoteAction, cancelOrderAction, changeStatusAction, createShipmentAction, deliverAction, deliveryStateAction, recordPaymentAction, refundAction,
  rejectPaymentAction, shipmentStatusAction, verifyPaymentAction,
} from "@/app/admin/_actions/orders";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, fmtDate, fmtDateTime } from "@/components/admin/ui";
import { Badge, Checkbox, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/store/icons";

export const metadata: Metadata = { title: "Order" };

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaffPage("orders.view");
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: {
      items: { include: { deliveries: true } },
      payments: { orderBy: { createdAt: "asc" } },
      refunds: { orderBy: { createdAt: "asc" } },
      shipments: { orderBy: { createdAt: "asc" } },
      history: { orderBy: { createdAt: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      user: { select: { id: true, name: true, email: true } },
      paymentMethod: true,
    },
  });
  if (!order) notFound();
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(user.role, p);
  const m = (c: number) => formatMoney(c, order.currency);
  const methods = await db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } });
  const transitions = allowedTransitions(order.status, { requiresShipping: order.requiresShipping, pickup: order.deliveryMethod === "PICKUP" });
  const deliveries = order.items.flatMap((i) => i.deliveries.map((d) => ({ ...d, item: i })));
  const keys = await revealLicenseKeys(deliveries.flatMap((d) => d.licenseKeyIds));
  const physical = order.items.filter((i) => i.productType === "PHYSICAL");
  const unfulfilled = physical.filter((i) => i.quantity - i.refundedQuantity - i.fulfilledQuantity > 0);
  const refundable = order.paidTotal - order.refundedTotal;
  const cost = order.items.reduce((s, i) => s + i.unitCost * i.quantity, 0);
  const waMsg = `Hello ${order.customerName}, this is Digital District about your order ${order.number}.`;

  return (
    <div className="print:text-black">
      <PageHeader
        back={{ href: "/admin/orders", label: "Orders" }}
        title={`Order ${order.number}`}
        description={<span className="flex flex-wrap items-center gap-2">Placed {fmtDateTime(order.placedAt)} · {order.source === "WHATSAPP" ? "via WhatsApp" : order.source === "ADMIN" ? "by staff" : "on the website"} <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge><Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge></span>}
        actions={
          <>
            <a href={waLink(order.phone, waMsg)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "sm")}><WhatsAppIcon className="size-4" /> WhatsApp customer</a>
            <Link href={`/admin/orders/${order.id}/invoice`} target="_blank" className={buttonClass("secondary", "sm")}><Printer className="size-4" /> Invoice</Link>
            <a href={orderUrl(order)} target="_blank" rel="noopener noreferrer" className={buttonClass("ghost", "sm")}>Customer view <ExternalLink className="size-3.5" /></a>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Panel title="Items" bodyClassName="p-0">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wider text-subtle"><tr className="border-b border-line"><th className="px-5 py-2.5">Item</th><th className="px-3 py-2.5 text-right">Qty</th><th className="px-3 py-2.5 text-right">Price</th><th className="px-5 py-2.5 text-right">Line total</th></tr></thead>
              <tbody>
                {order.items.map((i) => (
                  <tr key={i.id} className="border-b border-line/60 align-top last:border-0">
                    <td className="px-5 py-3">
                      <p className="font-semibold text-white">{i.productId ? <Link href={`/admin/products/${i.productId}`} className="hover:text-brand-200">{i.productTitle}</Link> : i.productTitle}</p>
                      <p className="text-xs text-subtle">{i.variantName !== "Default" && `${i.variantName} · `}SKU {i.sku} · {i.productType.toLowerCase()}{i.durationDays ? ` · ${i.durationDays} days` : ""}</p>
                      {Object.entries((i.customFields ?? {}) as Record<string, string>).map(([k, v]) => <p key={k} className="text-xs text-brand-200">{k}: {v}</p>)}
                      {i.customerNote && <p className="text-xs text-warning">Note: {i.customerNote}</p>}
                      {(i.fulfilledQuantity > 0 || i.refundedQuantity > 0) && <p className="text-xs text-subtle">{i.fulfilledQuantity} fulfilled{i.refundedQuantity ? ` · ${i.refundedQuantity} refunded (${i.restockedQuantity} restocked)` : ""}</p>}
                    </td>
                    <td className="px-3 py-3 text-right">{i.quantity}</td>
                    <td className="px-3 py-3 text-right">{m(i.unitPrice)}{i.unitPrice < i.listPrice && <p className="text-xs text-subtle line-through">{m(i.listPrice)}</p>}</td>
                    <td className="px-5 py-3 text-right">{m(i.lineTotal)}{i.couponDiscount > 0 && <p className="text-xs text-success">−{m(i.couponDiscount)} code</p>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1.5 border-t border-line px-5 py-4 text-sm">
              <Row label="Subtotal (list prices)" value={m(order.listSubtotal)} />
              {order.discountTotal > 0 && <Row label={`Discounts${order.couponCode ? ` (code ${order.couponCode})` : ""}`} value={`−${m(order.discountTotal)}`} />}
              {order.requiresShipping && <Row label={`Delivery${order.shippingZoneName ? ` — ${order.shippingZoneName}` : ""}`} value={m(order.shippingTotal)} />}
              {order.taxTotal > 0 && <Row label={order.taxInclusive ? "Tax included" : "Tax"} value={m(order.taxTotal)} />}
              <Row label="Total" value={m(order.total)} strong />
              <Row label="Paid" value={m(order.paidTotal)} />
              {order.refundedTotal > 0 && <Row label="Refunded" value={m(order.refundedTotal)} />}
              {can("finance.view") && <Row label="Cost of goods (at order time)" value={m(cost)} muted />}
            </dl>
          </Panel>

          {deliveries.length > 0 && (
            <Panel title="Digital delivery">
              <div className="space-y-4">
                {deliveries.map((d) => {
                  const content = readDeliveryContent(d.contentEnc);
                  const myKeys = keys.filter((k) => d.licenseKeyIds.includes(k.id));
                  return (
                    <div key={d.id} className="rounded-xl border border-line bg-surface-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{d.item.productTitle}{d.item.variantName !== "Default" ? ` — ${d.item.variantName}` : ""} × {d.item.quantity}</p>
                        <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : d.status === "REVOKED" ? "neutral" : "warning"}>{d.status.toLowerCase()}</Badge>
                      </div>
                      {d.failureReason && <p className="mt-1 text-xs text-danger">{d.failureReason}</p>}
                      {d.deliveredAt && <p className="mt-1 text-xs text-subtle">Delivered {fmtDateTime(d.deliveredAt)}{d.expiresAt ? ` · active until ${fmtDate(d.expiresAt)}` : ""}{d.assetIds.length ? ` · ${d.downloadCount} download(s)` : ""}</p>}
                      {content && <pre className="mt-2 whitespace-pre-wrap rounded-lg border border-line bg-ink p-3 font-mono text-xs">{content}</pre>}
                      {myKeys.map((k) => <p key={k.id} className="mt-2 font-mono text-xs text-brand-100">{k.code} <span className="text-subtle">({k.status.toLowerCase()})</span></p>)}
                      {d.internalNote && <p className="mt-2 text-xs text-subtle">Internal: {d.internalNote}</p>}
                      {can("orders.fulfill") && order.status !== "CANCELLED" && (
                        <div className="mt-3 space-y-3">
                          {d.status !== "DELIVERED" && d.status !== "REVOKED" && (
                            <details open={d.status !== "PENDING" || ["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus)}>
                              <summary className="cursor-pointer text-sm font-semibold text-brand-300">Deliver now</summary>
                              {!["PAID", "PARTIALLY_REFUNDED"].includes(order.paymentStatus) && <p className="mt-2 text-xs text-warning">This order is not marked as paid yet.</p>}
                              <ActionForm action={deliverAction} submitLabel="Mark as delivered" className="mt-3">
                                <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="deliveryId" value={d.id} />
                                <Field label="Details the customer will see" htmlFor={`c-${d.id}`} hint="Access details, account email and password, licence key, link, activation steps… Stored encrypted and shown only on the customer's private order page.">
                                  <Textarea id={`c-${d.id}`} name="content" required className="min-h-28 font-mono text-sm" />
                                </Field>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label="Starts" htmlFor={`s-${d.id}`}><Input id={`s-${d.id}`} name="startsAt" type="date" className="[color-scheme:dark]" /></Field>
                                  <Field label="Ends" htmlFor={`e-${d.id}`} hint={d.item.durationDays ? `Defaults to start + ${d.item.durationDays} days` : "Leave empty if it doesn't expire"}><Input id={`e-${d.id}`} name="expiresAt" type="date" className="[color-scheme:dark]" /></Field>
                                </div>
                                <Field label="Internal note (not shown to the customer)" htmlFor={`n-${d.id}`}><Input id={`n-${d.id}`} name="internalNote" /></Field>
                              </ActionForm>
                            </details>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {d.status === "PENDING" && <StateButton orderId={order.id} deliveryId={d.id} state="PROCESSING" label="Mark processing" />}
                            {(d.status === "FAILED" || d.status === "PENDING") && <StateButton orderId={order.id} deliveryId={d.id} state="RETRY" label="Run automatic delivery" />}
                          </div>
                          {d.status !== "REVOKED" && (
                            <details>
                              <summary className="cursor-pointer text-xs text-muted">{d.status === "DELIVERED" ? "Revoke access" : "Mark as failed"}</summary>
                              <ActionForm action={deliveryStateAction} submitLabel={d.status === "DELIVERED" ? "Revoke" : "Mark failed"} submitVariant="danger" className="mt-2">
                                <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="deliveryId" value={d.id} /><input type="hidden" name="state" value={d.status === "DELIVERED" ? "REVOKED" : "FAILED"} />
                                <Input name="reason" required placeholder="Reason" />
                              </ActionForm>
                            </details>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </Panel>
          )}

          {order.requiresShipping && (
            <Panel title="Shipping & fulfilment">
              <div className="space-y-3">
                <p className="text-sm text-muted">
                  {order.deliveryMethod === "PICKUP" ? "Customer pickup" : order.deliveryMethod === "NONE" ? "Delivery to be arranged on WhatsApp" : <>{[order.shipAddress, order.shipArea, order.shipCity].filter(Boolean).join(", ")}{order.shipInstructions && <><br />{order.shipInstructions}</>}</>}
                </p>
                {order.shipments.map((s) => (
                  <div key={s.id} className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{s.courier || "Own delivery"}{s.trackingNumber && <span className="ml-2 font-mono text-xs text-muted">{s.trackingNumber}</span>}</span>
                      <Badge tone={s.status === "DELIVERED" ? "success" : s.status === "RETURNED" || s.status === "FAILED" ? "danger" : "accent"}>{s.status.toLowerCase().replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-subtle">
                      {(s.items as { orderItemId: string; quantity: number }[]).map((x) => `${x.quantity}× ${order.items.find((i) => i.id === x.orderItemId)?.productTitle ?? "item"}`).join(", ")}
                      {s.shippingCost ? ` · courier cost ${m(s.shippingCost)}` : ""}{s.shippedAt ? ` · shipped ${fmtDate(s.shippedAt)}` : ""}{s.deliveredAt ? ` · delivered ${fmtDate(s.deliveredAt)}` : ""}
                    </p>
                    {can("orders.fulfill") && !["DELIVERED", "RETURNED"].includes(s.status) && (
                      <ActionForm action={shipmentStatusAction} submitLabel="Update" submitVariant="secondary" className="mt-3 flex flex-wrap items-end gap-2 space-y-0">
                        <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="shipmentId" value={s.id} />
                        <Select name="status" defaultValue={s.status} className="h-9 w-44 text-sm" aria-label="Shipment status">
                          {["PREPARING", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "RETURNED", "FAILED"].map((x) => <option key={x} value={x}>{x.toLowerCase().replace(/_/g, " ")}</option>)}
                        </Select>
                        <Input name="trackingNumber" defaultValue={s.trackingNumber ?? ""} placeholder="Tracking number" className="h-9 w-44 text-sm" />
                      </ActionForm>
                    )}
                  </div>
                ))}
                {can("orders.fulfill") && unfulfilled.length > 0 && !["PENDING", "AWAITING_PAYMENT", "CANCELLED"].includes(order.status) && (
                  <details className="rounded-xl border border-dashed border-line-strong p-4" open={order.shipments.length === 0}>
                    <summary className="cursor-pointer font-semibold">Create shipment</summary>
                    <ActionForm action={createShipmentAction} submitLabel="Create shipment" className="mt-4">
                      <input type="hidden" name="orderId" value={order.id} />
                      {unfulfilled.map((i) => (
                        <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                          <span>{i.productTitle}{i.variantName !== "Default" ? ` — ${i.variantName}` : ""}</span>
                          <Input name={`ship_${i.id}`} type="number" min={0} max={i.quantity - i.refundedQuantity - i.fulfilledQuantity} defaultValue={i.quantity - i.refundedQuantity - i.fulfilledQuantity} className="h-9 w-20" aria-label="Quantity to ship" />
                        </div>
                      ))}
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label="Status" htmlFor="sh-status"><Select id="sh-status" name="status" defaultValue={order.deliveryMethod === "PICKUP" ? "READY_FOR_PICKUP" : "SHIPPED"}><option value="PREPARING">Preparing</option><option value="SHIPPED">Shipped / out for delivery</option><option value="READY_FOR_PICKUP">Ready for pickup</option></Select></Field>
                        <Field label="Courier" htmlFor="sh-courier"><Input id="sh-courier" name="courier" placeholder="e.g. Aramex, Toters, own driver" /></Field>
                        <Field label="Tracking number" htmlFor="sh-tn"><Input id="sh-tn" name="trackingNumber" /></Field>
                        <Field label="Tracking link" htmlFor="sh-tu"><Input id="sh-tu" name="trackingUrl" type="url" placeholder="https://…" /></Field>
                        <Field label="Courier cost to you (USD)" htmlFor="sh-cost" hint="Recorded as a shipping expense"><Input id="sh-cost" name="shippingCost" inputMode="decimal" placeholder="0.00" /></Field>
                        <Field label="Note" htmlFor="sh-note"><Input id="sh-note" name="note" /></Field>
                      </div>
                    </ActionForm>
                  </details>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Payments & refunds">
            <div className="space-y-3 text-sm">
              <p className="text-muted">Method chosen: <span className="text-white">{order.paymentMethodName ?? "To be agreed on WhatsApp"}</span></p>
              {order.payments.map((p) => (
                <div key={p.id} className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{m(p.amount)} · {p.methodName}{p.reference && <span className="ml-2 font-mono text-xs text-muted">ref {p.reference}</span>}</span>
                    <Badge tone={p.status === "SUCCEEDED" ? "success" : p.status === "FAILED" ? "danger" : p.status === "PENDING" ? "warning" : "neutral"}>{p.status.toLowerCase()}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-subtle">
                    Submitted {fmtDateTime(p.createdAt)}{p.verifiedAt ? ` · ${p.status === "FAILED" ? "rejected" : "verified"} by ${p.verifiedByName ?? "—"} on ${fmtDateTime(p.verifiedAt)}` : ""}{p.fee ? ` · fee ${m(p.fee)}` : ""}
                  </p>
                  {p.failureReason && <p className="mt-1 text-xs text-danger">{p.failureReason}</p>}
                  {p.proofKey && <a href={`/api/admin/proof/${p.id}`} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-300">View payment proof <ExternalLink className="size-3" /></a>}
                  {p.status === "PENDING" && p.provider === "manual" && can("payments.verify") && (
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <ActionForm action={verifyPaymentAction} submitLabel="Verify payment" className="space-y-2">
                        <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="paymentId" value={p.id} />
                        <Input name="amount" defaultValue={centsToInput(p.amount)} inputMode="decimal" aria-label="Amount received" className="h-9" />
                        <Input name="note" placeholder="Note (optional)" className="h-9" />
                      </ActionForm>
                      <ActionForm action={rejectPaymentAction} submitLabel="Reject" submitVariant="danger" className="space-y-2">
                        <input type="hidden" name="orderId" value={order.id} /><input type="hidden" name="paymentId" value={p.id} />
                        <Input name="reason" required placeholder="Reason shown to the customer" className="h-9" />
                      </ActionForm>
                    </div>
                  )}
                </div>
              ))}
              {order.refunds.map((r) => (
                <div key={r.id} className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                  <p className="font-semibold text-warning">Refund {m(r.amount)}{r.method ? ` via ${r.method}` : ""}{r.reference ? ` · ref ${r.reference}` : ""}</p>
                  <p className="text-xs text-subtle">{r.reason} · {r.createdByName} · {fmtDateTime(r.createdAt)}{r.cogsReversed ? ` · ${m(r.cogsReversed)} returned to stock` : ""}</p>
                </div>
              ))}
              {can("payments.verify") && order.status !== "CANCELLED" && order.paidTotal < order.total && (
                <details className="rounded-xl border border-dashed border-line-strong p-4">
                  <summary className="cursor-pointer font-semibold">Record a payment received</summary>
                  <p className="mt-2 text-xs text-subtle">Use this for cash on delivery, or a transfer you confirmed on WhatsApp. Your name and the time are recorded.</p>
                  <ActionForm action={recordPaymentAction} submitLabel="Record payment" className="mt-3">
                    <input type="hidden" name="orderId" value={order.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Amount (USD)" htmlFor="rp-amount"><Input id="rp-amount" name="amount" inputMode="decimal" required defaultValue={centsToInput(order.total - order.paidTotal)} /></Field>
                      <Field label="Method" htmlFor="rp-method"><Select id="rp-method" name="methodId" defaultValue={order.paymentMethodId ?? ""}><option value="">{order.paymentMethodName ?? "Other"}</option>{methods.map((pm) => <option key={pm.id} value={pm.id}>{pm.name}</option>)}</Select></Field>
                      <Field label="Reference" htmlFor="rp-ref"><Input id="rp-ref" name="reference" /></Field>
                      <Field label="Note" htmlFor="rp-note"><Input id="rp-note" name="note" /></Field>
                    </div>
                  </ActionForm>
                </details>
              )}
              {can("refunds.manage") && refundable > 0 && (
                <details className="rounded-xl border border-dashed border-line-strong p-4">
                  <summary className="cursor-pointer font-semibold">Record a refund</summary>
                  <ActionForm action={refundAction} submitLabel="Record refund" submitVariant="danger" className="mt-3">
                    <input type="hidden" name="orderId" value={order.id} />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label={`Amount (max ${m(refundable)})`} htmlFor="rf-amount"><Input id="rf-amount" name="amount" inputMode="decimal" required /></Field>
                      <Field label="Refunded via" htmlFor="rf-method"><Input id="rf-method" name="method" placeholder="e.g. Whish, cash" /></Field>
                      <Field label="Reason" htmlFor="rf-reason" className="sm:col-span-2"><Input id="rf-reason" name="reason" required /></Field>
                      <Field label="Reference" htmlFor="rf-ref"><Input id="rf-ref" name="reference" /></Field>
                    </div>
                    <p className="text-xs text-subtle">Items being refunded (optional). Fully refunded digital items lose access. Tick “return to stock” for physical items you received back.</p>
                    {order.items.filter((i) => i.quantity > i.refundedQuantity).map((i) => (
                      <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span>{i.productTitle}{i.variantName !== "Default" ? ` — ${i.variantName}` : ""}</span>
                        <span className="flex items-center gap-3">
                          <Input name={`qty_${i.id}`} type="number" min={0} max={i.quantity - i.refundedQuantity} defaultValue={0} className="h-9 w-20" aria-label="Quantity refunded" />
                          {i.productType === "PHYSICAL" && <Checkbox name={`restock_${i.id}`} label="Return to stock" />}
                        </span>
                      </div>
                    ))}
                  </ActionForm>
                </details>
              )}
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Customer">
            <div className="space-y-1.5 text-sm">
              <p className="font-semibold text-white">{order.customerName}</p>
              <p><a href={`tel:+${order.phone}`} className="text-muted hover:text-white">{formatPhone(order.phone)}</a></p>
              {order.email && <p><a href={`mailto:${order.email}`} className="break-all text-muted hover:text-white">{order.email}</a></p>}
              <p className="text-xs text-subtle">Prefers {order.preferredContact.toLowerCase()}</p>
              {order.user && can("customers.view") && <Link href={`/admin/customers/${order.user.id}`} className="text-xs font-semibold text-brand-300">View customer profile →</Link>}
              {order.customerNote && <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 p-2 text-xs text-warning">“{order.customerNote}”</p>}
            </div>
          </Panel>

          {can("orders.manage") && order.status !== "CANCELLED" && (
            <Panel title="Order status">
              <div className="space-y-4">
                {transitions.length > 0 && (
                  <ActionForm action={changeStatusAction} submitLabel="Update status">
                    <input type="hidden" name="orderId" value={order.id} />
                    <Select name="status" aria-label="New status" defaultValue={transitions[0]}>
                      {transitions.map((t) => <option key={t} value={t}>{ORDER_STATUS_LABELS[t]}</option>)}
                    </Select>
                    <Input name="note" placeholder="Note for the history (optional)" />
                    <Checkbox name="notify" defaultChecked={Boolean(order.email)} label="Email the customer about this change" />
                  </ActionForm>
                )}
                {CANCELLABLE.includes(order.status) && (
                  <details>
                    <summary className="cursor-pointer text-sm text-muted hover:text-danger">{order.status === "PENDING" ? "Reject / cancel order" : "Cancel order"}</summary>
                    <ActionForm action={cancelOrderAction} submitLabel="Cancel order" submitVariant="danger" className="mt-3">
                      <input type="hidden" name="orderId" value={order.id} />
                      <Textarea name="reason" required placeholder="Reason (shown to the customer)" className="min-h-16" />
                      <p className="text-xs text-subtle">Stock is returned automatically. Orders with payments must be refunded first.</p>
                    </ActionForm>
                  </details>
                )}
              </div>
            </Panel>
          )}

          <Panel title="Private notes">
            <ActionForm action={addNoteAction} submitLabel="Add note" submitVariant="secondary" resetOnSuccess>
              <input type="hidden" name="orderId" value={order.id} />
              <Textarea name="body" required placeholder="Only staff can see notes" className="min-h-16" />
            </ActionForm>
            <ul className="mt-4 space-y-3 text-sm">
              {order.notes.map((n) => (
                <li key={n.id} className="rounded-lg bg-surface-2 p-3">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="mt-1 text-xs text-subtle">{n.authorName} · {fmtDateTime(n.createdAt)}</p>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="History">
            <ol className="space-y-3 text-sm">
              {order.history.map((h) => (
                <li key={h.id} className="border-l-2 border-brand-500/40 pl-3">
                  <p className="text-fg">{h.kind === "PAYMENT" ? "Payment: " : ""}{h.fromStatus ? `${label(h.fromStatus)} → ` : ""}{label(h.toStatus)}</p>
                  {h.note && <p className="text-xs text-muted">{h.note}</p>}
                  <p className="text-xs text-subtle">{h.actorName ?? "System"} · {fmtDateTime(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function label(s: string) {
  return (ORDER_STATUS_LABELS as Record<string, string>)[s] ?? (PAYMENT_STATUS_LABELS as Record<string, string>)[s] ?? s.toLowerCase().replace(/_/g, " ");
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t border-line pt-2 text-base font-semibold text-white" : muted ? "text-subtle" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function StateButton({ orderId, deliveryId, state, label: text }: { orderId: string; deliveryId: string; state: string; label: string }) {
  return (
    <ActionForm action={deliveryStateAction} submitLabel={text} submitVariant="secondary" className="space-y-1">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <input type="hidden" name="state" value={state} />
    </ActionForm>
  );
}
