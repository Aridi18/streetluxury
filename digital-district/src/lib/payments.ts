import type { Order, User } from "@prisma/client";
import { db, type Tx } from "./db";
import { UserError } from "./errors";
import { percentOf } from "./money";
import { addHistory, refreshPaymentStatus, setOrderStatus } from "./order-core";
import { autoFulfillDigital } from "./fulfillment";
import { notifyStaff } from "./notifications";
import { audit } from "./audit";
import { emailDeliveryReady, emailPaymentConfirmed, emailPaymentRejected } from "./emails";
import { env } from "./env";

type Actor = Pick<User, "id" | "name"> | null;

/**
 * Everything that happens when an order becomes fully paid for the first time:
 * it is confirmed, bestseller counters update, and automatic digital delivery runs.
 */
export async function handleOrderPaid(tx: Tx, orderId: string, actor: Actor) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
  if (order.status === "PENDING" || order.status === "AWAITING_PAYMENT") await setOrderStatus(tx, order, "CONFIRMED", "Payment received", actor);
  for (const item of order.items) {
    if (item.productId) await tx.product.update({ where: { id: item.productId }, data: { salesCount: { increment: item.quantity } } });
  }
  return autoFulfillDigital(tx, orderId, actor);
}

export function balanceDue(o: Pick<Order, "total" | "paidTotal" | "refundedTotal">) {
  return Math.max(0, o.total - o.paidTotal);
}

/** Customer submits a transaction reference and/or proof for a manual payment method (Whish, OMT, USDT, bank…). */
export async function submitManualPayment(orderId: string, input: { reference: string | null; proof: { key: string; mimeType: string } | null }) {
  const reference = input.reference?.trim().slice(0, 120) || null;
  return db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { paymentMethod: true, payments: true } });
    if (!order) throw new UserError("Order not found.");
    if (order.status === "CANCELLED") throw new UserError("This order was cancelled.");
    if (!["UNPAID", "FAILED", "PARTIALLY_PAID"].includes(order.paymentStatus)) throw new UserError("A payment is already being verified for this order.");
    const method = order.paymentMethod;
    if (!method || method.kind !== "MANUAL") throw new UserError("This order's payment method does not use payment references.");
    if (method.requiresReference && !reference) throw new UserError("Enter the transaction reference.");
    if (!reference && !input.proof) throw new UserError("Enter a transaction reference or upload a payment proof.");
    if (input.proof && !method.allowProofUpload) throw new UserError("Proof uploads are not enabled for this payment method.");
    const amount = balanceDue(order);
    if (amount <= 0) throw new UserError("Nothing is due on this order.");
    const payment = await tx.payment.create({
      data: { orderId, methodId: method.id, methodName: method.name, provider: "manual", amount, status: "PENDING", reference, proofKey: input.proof?.key, proofMimeType: input.proof?.mimeType },
    });
    await refreshPaymentStatus(tx, orderId, null, `Customer submitted payment${reference ? ` (ref ${reference})` : ""}`);
    await notifyStaff({ type: "payment_submitted", title: `Payment to verify: ${order.number}`, body: `${method.name}${reference ? ` · ref ${reference}` : ""}`, link: `/admin/orders/${orderId}`, permission: "payments.verify" }, tx);
    return payment;
  });
}

function feeFor(method: { feePercentBps: number; feeFixed: number } | null, amount: number) {
  if (!method) return 0;
  return percentOf(amount, method.feePercentBps) + method.feeFixed;
}

/** Staff confirm that a submitted manual payment really arrived. Records who confirmed it and when. */
export async function verifyPayment(actor: User, paymentId: string, input: { amount?: number; note?: string | null }) {
  const result = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { method: true, order: true } });
    if (!payment) throw new UserError("Payment not found.");
    if (payment.status !== "PENDING") throw new UserError("This payment has already been processed.");
    if (payment.order.status === "CANCELLED") throw new UserError("This order is cancelled.");
    const amount = input.amount ?? payment.amount;
    if (!Number.isInteger(amount) || amount <= 0) throw new UserError("Enter the amount actually received.");
    await tx.payment.update({
      where: { id: paymentId },
      data: { status: "SUCCEEDED", amount, fee: feeFor(payment.method, amount), verifiedById: actor.id, verifiedByName: actor.name, verifiedAt: new Date() },
    });
    const { becamePaid } = await refreshPaymentStatus(tx, payment.orderId, actor, `Payment verified${input.note ? `: ${input.note}` : ""}`);
    const delivered = becamePaid ? await handleOrderPaid(tx, payment.orderId, actor) : 0;
    await audit(actor, "payment.verify", "Payment", paymentId, `${payment.order.number}: ${amount / 100} via ${payment.methodName}`, undefined, tx);
    return { order: await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } }), becamePaid, delivered };
  });
  if (result.becamePaid) await emailPaymentConfirmed(result.order);
  if (result.delivered) await emailDeliveryReady(result.order);
  return result;
}

export async function rejectPayment(actor: User, paymentId: string, reason: string) {
  if (!reason.trim()) throw new UserError("Give the customer a reason.");
  const order = await db.$transaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) throw new UserError("Payment not found.");
    if (payment.status !== "PENDING") throw new UserError("This payment has already been processed.");
    await tx.payment.update({ where: { id: paymentId }, data: { status: "FAILED", failureReason: reason.trim(), verifiedById: actor.id, verifiedByName: actor.name, verifiedAt: new Date() } });
    await refreshPaymentStatus(tx, payment.orderId, actor, `Payment rejected: ${reason.trim()}`);
    await audit(actor, "payment.reject", "Payment", paymentId, `${payment.order.number}: ${reason.trim()}`, undefined, tx);
    return tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  });
  await emailPaymentRejected(order, reason.trim());
}

/** Staff record money received outside the website (cash on delivery, transfer confirmed on WhatsApp…). */
export async function recordPayment(actor: User, orderId: string, input: { amount: number; methodId: string | null; reference: string | null; note: string | null }) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new UserError("Enter the amount received.");
  const result = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId } });
    if (!order) throw new UserError("Order not found.");
    if (order.status === "CANCELLED") throw new UserError("This order is cancelled.");
    if (order.paidTotal + input.amount > order.total) throw new UserError(`That is more than the balance due (${(balanceDue(order) / 100).toFixed(2)}).`);
    const method = input.methodId ? await tx.paymentMethod.findUnique({ where: { id: input.methodId } }) : order.paymentMethodId ? await tx.paymentMethod.findUnique({ where: { id: order.paymentMethodId } }) : null;
    await tx.payment.create({
      data: {
        orderId,
        methodId: method?.id,
        methodName: method?.name ?? order.paymentMethodName ?? "Manual",
        provider: "manual",
        amount: input.amount,
        fee: feeFor(method, input.amount),
        status: "SUCCEEDED",
        reference: input.reference,
        verifiedById: actor.id,
        verifiedByName: actor.name,
        verifiedAt: new Date(),
      },
    });
    const { becamePaid } = await refreshPaymentStatus(tx, orderId, actor, `Payment recorded${input.note ? `: ${input.note}` : ""}`);
    const delivered = becamePaid ? await handleOrderPaid(tx, orderId, actor) : 0;
    await audit(actor, "payment.record", "Order", orderId, `${order.number}: ${input.amount / 100} recorded`, undefined, tx);
    return { order: await tx.order.findUniqueOrThrow({ where: { id: orderId } }), becamePaid, delivered };
  });
  if (result.becamePaid) await emailPaymentConfirmed(result.order);
  if (result.delivered) await emailDeliveryReady(result.order);
  return result;
}

// ───────────── Online card payments: Mastercard Payment Gateway Services (hosted checkout) ─────────────
// Used by Lebanese acquirers such as areeba. Card details are entered on the gateway's hosted page and never
// touch this server. A payment is only marked successful after this server asks the gateway for the order's
// status with its private API credentials — redirects and webhooks are treated as hints, never as proof.

function mpgsAuthHeader() {
  return "Basic " + Buffer.from(`merchant.${env.mpgs.merchantId}:${env.mpgs.apiPassword}`).toString("base64");
}

function mpgsUrl(path: string) {
  return `${env.mpgs.gatewayUrl}/api/rest/version/${env.mpgs.apiVersion}/merchant/${encodeURIComponent(env.mpgs.merchantId)}${path}`;
}

export function mpgsConfigured() {
  return env.mpgs.configured;
}

export async function startCardPayment(orderId: string, returnUrl: string) {
  if (!mpgsConfigured()) throw new UserError("Online card payment is not available right now.");
  const order = await db.order.findUnique({ where: { id: orderId }, include: { paymentMethod: true } });
  if (!order || order.paymentMethod?.kind !== "ONLINE_CARD") throw new UserError("This order is not set up for card payment.");
  if (order.status === "CANCELLED") throw new UserError("This order was cancelled.");
  const amount = balanceDue(order);
  if (amount <= 0) throw new UserError("This order is already paid.");
  const attempt = await db.payment.count({ where: { orderId } });
  const providerOrderId = `${order.number}-${attempt + 1}`;
  const res = await fetch(mpgsUrl("/session"), {
    method: "POST",
    headers: { Authorization: mpgsAuthHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({
      apiOperation: "INITIATE_CHECKOUT",
      interaction: { operation: "PURCHASE", returnUrl, merchant: { name: "Digital District" }, displayControl: { billingAddress: "HIDE", shipping: "HIDE" } },
      order: { id: providerOrderId, amount: (amount / 100).toFixed(2), currency: order.currency, description: `Order ${order.number}` },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as { result?: string; session?: { id?: string }; successIndicator?: string; error?: unknown };
  if (!res.ok || body.result !== "SUCCESS" || !body.session?.id) {
    await db.paymentEvent.create({ data: { provider: "mpgs", type: "session_error", payload: JSON.parse(JSON.stringify({ status: res.status, body })) } });
    throw new UserError("We could not start the card payment. Please try again or choose another payment method.");
  }
  await db.payment.create({
    data: {
      orderId,
      methodId: order.paymentMethodId,
      methodName: order.paymentMethodName ?? "Card",
      provider: "mpgs",
      amount,
      status: "PENDING",
      providerOrderId,
      providerSecret: body.successIndicator ?? null,
    },
  });
  return { sessionId: body.session.id, checkoutScript: `${env.mpgs.gatewayUrl}/static/checkout/checkout.min.js` };
}

type MpgsOrder = { result?: string; status?: string; amount?: number; currency?: string; totalCapturedAmount?: number; transaction?: { transaction?: { id?: string } }[] };

/** Asks the gateway for the authoritative status of a card payment and updates our records to match. */
export async function syncCardPayment(providerOrderId: string, source: string) {
  if (!mpgsConfigured()) return null;
  const payment = await db.payment.findUnique({ where: { providerOrderId }, include: { order: true, method: true } });
  if (!payment) return null;
  if (payment.status !== "PENDING") return payment;
  const res = await fetch(mpgsUrl(`/order/${encodeURIComponent(providerOrderId)}`), { headers: { Authorization: mpgsAuthHeader() } });
  const body = (await res.json().catch(() => ({}))) as MpgsOrder;
  await db.paymentEvent.create({ data: { paymentId: payment.id, provider: "mpgs", type: `retrieve_order:${source}`, payload: JSON.parse(JSON.stringify(body)) } });
  if (!res.ok) return payment;
  const captured = Math.round((body.totalCapturedAmount ?? 0) * 100);
  const succeeded = body.result === "SUCCESS" && (body.status === "CAPTURED" || captured >= payment.amount) && body.currency === payment.order.currency && captured >= payment.amount;
  const failed = ["FAILED", "CANCELLED", "EXPIRED"].includes(String(body.status)) || body.result === "FAILURE";
  if (!succeeded && !failed) return payment;
  const result = await db.$transaction(async (tx) => {
    const claimed = await tx.payment.updateMany({
      where: { id: payment.id, status: "PENDING" },
      data: succeeded
        ? { status: "SUCCEEDED", amount: captured, fee: feeFor(payment.method, captured), providerTransactionId: body.transaction?.at(-1)?.transaction?.id ?? null, verifiedAt: new Date(), verifiedByName: "Card gateway" }
        : { status: "FAILED", failureReason: `Gateway status ${body.status ?? "unknown"}` },
    });
    if (!claimed.count) return { becamePaid: false, delivered: 0 };
    const { becamePaid } = await refreshPaymentStatus(tx, payment.orderId, null, succeeded ? "Card payment captured" : "Card payment failed");
    const delivered = becamePaid ? await handleOrderPaid(tx, payment.orderId, null) : 0;
    if (succeeded) await addHistory(tx, payment.orderId, "PAYMENT", null, "CARD_CAPTURED", `Gateway order ${providerOrderId}`, null);
    return { becamePaid, delivered };
  });
  const order = await db.order.findUniqueOrThrow({ where: { id: payment.orderId } });
  if (result.becamePaid) await emailPaymentConfirmed(order);
  if (result.delivered) await emailDeliveryReady(order);
  return db.payment.findUnique({ where: { id: payment.id } });
}
