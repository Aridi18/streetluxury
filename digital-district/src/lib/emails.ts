import type { Order, OrderItem } from "@prisma/client";
import { env } from "./env";
import { renderEmail, sendEmail } from "./email";
import { formatMoney } from "./money";
import { orderUrl } from "./order-core";
import { ORDER_STATUS_LABELS } from "./order-status";

type OrderWithItems = Order & { items: OrderItem[] };

function itemLines(o: OrderWithItems) {
  return o.items.map((i) => `• ${i.productTitle}${i.variantName !== "Default" ? ` (${i.variantName})` : ""} × ${i.quantity} — ${formatMoney(i.lineTotal, o.currency)}`).join("\n");
}

export async function emailOrderPlaced(o: OrderWithItems) {
  const content = renderEmail({
    heading: `Thank you — order ${o.number} received`,
    paragraphs: [
      `Hi ${o.customerName}, we have received your order.`,
      itemLines(o),
      `Total: ${formatMoney(o.total, o.currency)}${o.paymentMethodName ? ` · Payment: ${o.paymentMethodName}` : ""}`,
      o.status === "AWAITING_PAYMENT"
        ? "Your order will be processed once your payment is verified. The payment instructions are on your order page."
        : "Our team will confirm your order shortly, usually on WhatsApp.",
    ],
    button: { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Order ${o.number} received`, "order_placed", content);
}

export async function emailOwnerNewOrder(o: OrderWithItems) {
  if (!env.ownerAlertEmail) return;
  const content = renderEmail({
    heading: `New ${o.source === "WHATSAPP" ? "WhatsApp " : ""}order ${o.number}`,
    paragraphs: [`${o.customerName} · +${o.phone}`, itemLines(o), `Total: ${formatMoney(o.total, o.currency)}`],
    button: { label: "Open in admin", url: `${env.appUrl}/admin/orders/${o.id}` },
  });
  await sendEmail(env.ownerAlertEmail, `New order ${o.number} — ${formatMoney(o.total, o.currency)}`, "owner_new_order", content);
}

export async function emailPaymentConfirmed(o: Order) {
  const content = renderEmail({
    heading: `Payment confirmed for ${o.number}`,
    paragraphs: [`Hi ${o.customerName}, we have confirmed your payment of ${formatMoney(o.paidTotal, o.currency)}. We are now preparing your order.`],
    button: { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Payment confirmed — ${o.number}`, "payment_confirmed", content);
}

export async function emailPaymentRejected(o: Order, reason: string) {
  const content = renderEmail({
    heading: `We could not verify your payment for ${o.number}`,
    paragraphs: [`Hi ${o.customerName}, we could not verify the payment you submitted.`, `Reason: ${reason}`, "You can submit a new payment reference from your order page, or contact us on WhatsApp."],
    button: { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Payment not verified — ${o.number}`, "payment_rejected", content);
}

export async function emailDeliveryReady(o: Order) {
  const content = renderEmail({
    heading: `Your order ${o.number} is ready`,
    paragraphs: [`Hi ${o.customerName}, your digital items have been delivered. For your security, access details are only shown on your private order page.`],
    button: { label: "Open your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Your order ${o.number} is ready`, "delivery_ready", content);
}

export async function emailShipped(o: Order, tracking: { courier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null }) {
  const content = renderEmail({
    heading: `Order ${o.number} is on its way`,
    paragraphs: [
      `Hi ${o.customerName}, your order has been handed to ${tracking.courier || "our delivery team"}.`,
      tracking.trackingNumber ? `Tracking number: ${tracking.trackingNumber}` : "",
    ].filter(Boolean),
    button: tracking.trackingUrl ? { label: "Track your parcel", url: tracking.trackingUrl } : { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Order ${o.number} shipped`, "order_shipped", content);
}

export async function emailStatusChanged(o: Order) {
  const content = renderEmail({
    heading: `Order ${o.number}: ${ORDER_STATUS_LABELS[o.status]}`,
    paragraphs: [`Hi ${o.customerName}, the status of your order is now “${ORDER_STATUS_LABELS[o.status]}”.`],
    button: { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Order ${o.number} — ${ORDER_STATUS_LABELS[o.status]}`, "order_status", content);
}

export async function emailRefund(o: Order, amount: number) {
  const content = renderEmail({
    heading: `Refund recorded for ${o.number}`,
    paragraphs: [`Hi ${o.customerName}, we have recorded a refund of ${formatMoney(amount, o.currency)} for your order.`],
    button: { label: "View your order", url: orderUrl(o) },
  });
  await sendEmail(o.email, `Refund for ${o.number}`, "refund", content);
}
