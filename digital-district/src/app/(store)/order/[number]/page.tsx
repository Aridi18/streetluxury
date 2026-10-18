import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Download, KeyRound, PackageCheck, Truck } from "lucide-react";
import { loadOrderForViewer } from "@/lib/order-access";
import { getSettings } from "@/lib/settings";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { orderAccessKey, orderUrl } from "@/lib/order-core";
import { CUSTOMER_CANCELLABLE, ORDER_STATUS_LABELS, ORDER_STATUS_TONE, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from "@/lib/order-status";
import { orderWhatsAppMessage, waLink, waWebLink } from "@/lib/whatsapp";
import { readDeliveryContent, revealLicenseKeys } from "@/lib/fulfillment";
import { db } from "@/lib/db";
import { Markdown } from "@/components/markdown";
import { WhatsAppPanel } from "@/components/store/whatsapp-panel";
import { CancelOrderForm, PaymentSubmitForm } from "@/components/store/order-forms";
import { ProductImage } from "@/components/store/product-image";
import { WhatsAppIcon } from "@/components/store/icons";
import { Alert, Badge, LinkButton, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

const dt = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Beirut" });
const dOnly = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Beirut" });

export default async function OrderPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ key?: string; placed?: string; wa?: string }> }) {
  const { number } = await params;
  const sp = await searchParams;
  const access = await loadOrderForViewer(decodeURIComponent(number), sp.key);
  if (!access) notFound();
  const { order } = access;
  const settings = await getSettings();
  const m = (c: number) => formatMoney(c, order.currency);
  const key = orderAccessKey(order.id);
  const items = order.items.map((i) => ({ ...i, customFields: (i.customFields ?? {}) as Record<string, string> }));

  const message = orderWhatsAppMessage({ ...order, items, orderUrl: orderUrl(order) });
  const showWhatsApp = order.source === "WHATSAPP" && order.status === "PENDING";
  const method = order.paymentMethod;
  const paid = order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED";
  const canSubmitPayment = method?.kind === "MANUAL" && ["UNPAID", "FAILED", "PARTIALLY_PAID"].includes(order.paymentStatus) && order.status !== "CANCELLED";
  const pendingPayment = order.payments.find((p) => p.status === "PENDING" && p.provider === "manual");
  const lastFailed = [...order.payments].reverse().find((p) => p.status === "FAILED");
  const deliveries = order.items.flatMap((i) => i.deliveries.map((d) => ({ ...d, item: i })));
  const keyIds = deliveries.filter((d) => d.status === "DELIVERED").flatMap((d) => d.licenseKeyIds);
  const keys = paid ? await revealLicenseKeys(keyIds) : [];
  const assetIds = deliveries.filter((d) => d.status === "DELIVERED").flatMap((d) => d.assetIds);
  const assets = paid && assetIds.length ? await db.digitalAsset.findMany({ where: { id: { in: assetIds } } }) : [];
  const timeline = order.history.filter((h) => !h.toStatus.startsWith("DIGITAL_") || h.toStatus === "DIGITAL_DELIVERED");

  return (
    <div className="container-page max-w-5xl py-10">
      {sp.placed && order.status !== "CANCELLED" && (
        <div className="mb-8 flex items-start gap-4 rounded-2xl border border-success/30 bg-success/10 p-5">
          <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-success" />
          <div>
            <p className="font-semibold text-white">{showWhatsApp ? "Your order is saved — now send it to us on WhatsApp" : "Thank you! Your order has been received."}</p>
            <p className="text-sm text-muted">
              Keep your order number <span className="font-mono font-semibold text-white">{order.number}</span>.
              {order.email ? " We've also emailed you a link to this page." : " Bookmark this page to come back to it."}
            </p>
          </div>
        </div>
      )}

      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">Order</p>
          <h1 className="font-mono text-3xl font-bold text-white">{order.number}</h1>
          <p className="mt-1 text-sm text-muted">Placed {dt(order.placedAt)}{order.source === "WHATSAPP" ? " · via WhatsApp" : ""}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={ORDER_STATUS_TONE[order.status]}>{ORDER_STATUS_LABELS[order.status]}</Badge>
          <Badge tone={PAYMENT_STATUS_TONE[order.paymentStatus]}>{PAYMENT_STATUS_LABELS[order.paymentStatus]}</Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          {showWhatsApp && (
            <section className="card space-y-4 border-[#25D366]/30 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><WhatsAppIcon className="size-5 text-[#25D366]" /> Send your order on WhatsApp</h2>
              <p className="text-sm text-muted">
                Tap <strong className="text-white">Open WhatsApp</strong> and press send. Your order is confirmed once our team replies — opening WhatsApp alone doesn&apos;t confirm or pay for it.
              </p>
              <WhatsAppPanel message={message} appLink={waLink(settings.whatsappNumber, message)} webLink={waWebLink(settings.whatsappNumber, message)} autoOpen={Boolean(sp.wa)} orderNumber={order.number} />
            </section>
          )}

          {order.status === "CANCELLED" && <Alert tone="danger" title="This order was cancelled">{order.cancelReason}</Alert>}

          {method && order.status !== "CANCELLED" && !paid && (
            <section className="card space-y-4 p-6">
              <h2 className="text-lg font-semibold">Payment — {method.name}</h2>
              {method.instructions && <Markdown source={method.instructions} />}
              {method.kind === "MANUAL" && <p className="text-sm text-muted">Amount to pay: <strong className="text-white">{m(Math.max(0, order.total - order.paidTotal))}</strong> · Reference: <strong className="font-mono text-white">{order.number}</strong></p>}
              {pendingPayment && <Alert tone="accent" title="We're verifying your payment">Reference {pendingPayment.reference ?? "—"} received {dt(pendingPayment.createdAt)}. We&apos;ll update this page once it&apos;s confirmed.</Alert>}
              {lastFailed && order.paymentStatus === "FAILED" && <Alert tone="danger" title="We couldn't verify your last payment">{lastFailed.failureReason}</Alert>}
              {canSubmitPayment && <PaymentSubmitForm number={order.number} accessKey={key} requiresReference={method.requiresReference} allowProof={method.allowProofUpload} />}
              {method.kind === "ONLINE_CARD" && <LinkButton href={`/order/${order.number}/pay?key=${key}`}>Pay {m(order.total - order.paidTotal)} by card</LinkButton>}
            </section>
          )}

          {deliveries.length > 0 && (
            <section className="card space-y-4 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><KeyRound className="size-5 text-brand-300" /> Digital delivery</h2>
              {!paid && order.status !== "CANCELLED" && <p className="text-sm text-muted">Your access details will appear here as soon as your payment is confirmed.</p>}
              <ul className="space-y-4">
                {deliveries.map((d) => {
                  const content = paid && d.status === "DELIVERED" ? readDeliveryContent(d.contentEnc) : null;
                  const myKeys = keys.filter((k) => d.licenseKeyIds.includes(k.id));
                  const myAssets = assets.filter((a) => d.assetIds.includes(a.id));
                  return (
                    <li key={d.id} className="rounded-xl border border-line bg-surface-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{d.item.productTitle}{d.item.variantName !== "Default" ? ` — ${d.item.variantName}` : ""}</p>
                        <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : d.status === "REVOKED" ? "neutral" : "warning"}>
                          {d.status === "DELIVERED" ? "Delivered" : d.status === "FAILED" ? "Delayed — we're on it" : d.status === "REVOKED" ? "Revoked" : d.status === "PROCESSING" ? "Being prepared" : "Pending"}
                        </Badge>
                      </div>
                      {paid && d.status === "DELIVERED" && (
                        <div className="mt-3 space-y-3 text-sm">
                          {content && <pre className="whitespace-pre-wrap rounded-lg border border-line bg-ink p-3 font-mono text-[13px] text-fg">{content}</pre>}
                          {myKeys.map((k) => (
                            <p key={k.id} className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 font-mono text-[13px] text-brand-50 select-all">{k.code}</p>
                          ))}
                          {myAssets.map((a) => (
                            <a key={a.id} href={`/api/downloads/${d.id}/${a.id}?key=${key}`} className={buttonClass("secondary", "sm")}>
                              <Download className="size-4" /> {a.fileName}
                            </a>
                          ))}
                          {myAssets.length > 0 && (d.downloadExpiresAt || d.maxDownloads) && (
                            <p className="text-xs text-subtle">
                              {d.downloadExpiresAt && `Downloads available until ${dOnly(d.downloadExpiresAt)}. `}
                              {d.maxDownloads != null && `${Math.max(0, d.maxDownloads - d.downloadCount)} download(s) left.`}
                            </p>
                          )}
                          {d.item.product?.activationInstructions && <div className="rounded-lg border border-line p-3"><p className="mb-1 font-semibold text-white">How to activate</p><Markdown source={d.item.product.activationInstructions} /></div>}
                          {d.expiresAt && <p className="flex items-center gap-1.5 text-xs text-muted"><Clock className="size-3.5" /> Active until {dOnly(d.expiresAt)}</p>}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {order.requiresShipping && (
            <section className="card space-y-4 p-6">
              <h2 className="flex items-center gap-2 text-lg font-semibold"><Truck className="size-5 text-brand-300" /> {order.deliveryMethod === "PICKUP" ? "Pickup" : "Delivery"}</h2>
              {order.deliveryMethod === "DELIVERY" && (
                <p className="text-sm text-muted">{order.customerName} · {formatPhone(order.phone)}<br />{[order.shipAddress, order.shipArea, order.shipCity].filter(Boolean).join(", ")}{order.shippingZoneName ? ` (${order.shippingZoneName})` : ""}{order.shipInstructions && <><br />{order.shipInstructions}</>}</p>
              )}
              {order.deliveryMethod === "PICKUP" && <p className="text-sm text-muted">{settings.pickupAddress}{settings.pickupInstructions && <><br />{settings.pickupInstructions}</>}</p>}
              {order.deliveryMethod === "NONE" && <p className="text-sm text-muted">Delivery will be arranged with you on WhatsApp.</p>}
              {order.shipments.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 p-3 text-sm">
                  <span className="flex items-center gap-2"><PackageCheck className="size-4 text-brand-300" /> {s.courier || "Our delivery team"}{s.trackingNumber && <> · <span className="font-mono">{s.trackingNumber}</span></>}</span>
                  <span className="flex items-center gap-2">
                    <Badge tone={s.status === "DELIVERED" ? "success" : s.status === "RETURNED" || s.status === "FAILED" ? "danger" : "accent"}>{s.status.replace(/_/g, " ").toLowerCase()}</Badge>
                    {s.trackingUrl && <a href={s.trackingUrl} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline">Track</a>}
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-semibold">Order history</h2>
            <ol className="relative space-y-4 border-l border-line pl-5">
              {timeline.map((h) => (
                <li key={h.id} className="text-sm">
                  <span className="absolute -left-[5px] mt-1.5 size-2.5 rounded-full bg-brand-400" />
                  <p className="font-medium text-white">
                    {h.kind === "PAYMENT"
                      ? h.toStatus === "REFUND" ? "Refund recorded" : h.toStatus === "CARD_CAPTURED" ? "Card payment received" : `Payment: ${PAYMENT_STATUS_LABELS[h.toStatus as keyof typeof PAYMENT_STATUS_LABELS] ?? h.toStatus}`
                      : h.toStatus === "DIGITAL_DELIVERED" ? "Digital item delivered" : ORDER_STATUS_LABELS[h.toStatus as keyof typeof ORDER_STATUS_LABELS] ?? h.toStatus}
                  </p>
                  <p className="text-xs text-subtle">{dt(h.createdAt)}</p>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-36">
          <section className="card p-5">
            <h2 className="mb-4 font-semibold">Items</h2>
            <ul className="space-y-3">
              {items.map((i) => (
                <li key={i.id} className="flex gap-3 text-sm">
                  <div className="size-12 shrink-0 overflow-hidden rounded-lg"><ProductImage imageKey={i.product?.images[0]?.key ?? null} alt="" title={i.productTitle} sizes="48px" /></div>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{i.productTitle}</p>
                    <p className="text-xs text-muted">{i.variantName !== "Default" ? `${i.variantName} · ` : ""}× {i.quantity}</p>
                    {Object.entries(i.customFields).map(([k, v]) => <p key={k} className="text-xs text-subtle">{k}: {v}</p>)}
                    {i.refundedQuantity > 0 && <p className="text-xs text-warning">{i.refundedQuantity} refunded</p>}
                  </div>
                  <p className="font-semibold">{m(i.unitPrice * i.quantity)}</p>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{m(order.listSubtotal)}</dd></div>
              {order.discountTotal > 0 && <div className="flex justify-between"><dt className="text-muted">Discounts{order.couponCode ? ` (${order.couponCode})` : ""}</dt><dd className="text-success">−{m(order.discountTotal)}</dd></div>}
              {order.requiresShipping && <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd>{order.shippingTotal ? m(order.shippingTotal) : "Free"}</dd></div>}
              {order.taxTotal > 0 && <div className="flex justify-between text-subtle"><dt>{order.taxInclusive ? "Includes tax" : "Tax"}</dt><dd>{m(order.taxTotal)}</dd></div>}
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd className="text-white">{m(order.total)}</dd></div>
              {order.paidTotal > 0 && <div className="flex justify-between text-success"><dt>Paid</dt><dd>{m(order.paidTotal)}</dd></div>}
              {order.refundedTotal > 0 && <div className="flex justify-between text-warning"><dt>Refunded</dt><dd>{m(order.refundedTotal)}</dd></div>}
            </dl>
          </section>
          <section className="card space-y-3 p-5 text-sm">
            <p className="font-semibold">Need help with this order?</p>
            <a href={waLink(settings.whatsappNumber, `Hello Digital District, I have a question about order ${order.number}.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "md", "w-full")}>
              <WhatsAppIcon className="size-4" /> Message us on WhatsApp
            </a>
            {access.viewer.isOwner && <Link href={`/account/support?order=${order.number}`} className="block text-center text-brand-300 hover:text-brand-200">Request a return or support</Link>}
            {CUSTOMER_CANCELLABLE.includes(order.status) && order.paymentStatus !== "PENDING_VERIFICATION" && order.paidTotal === 0 && <CancelOrderForm number={order.number} accessKey={key} />}
          </section>
        </aside>
      </div>
    </div>
  );
}
