import type { OrderStatus, User } from "@prisma/client";
import { db } from "./db";
import { UserError } from "./errors";
import { addHistory, refreshPaymentStatus, setOrderStatus } from "./order-core";
import { CANCELLABLE, CUSTOMER_CANCELLABLE, canTransition, ORDER_STATUS_LABELS } from "./order-status";
import { restoreStock } from "./inventory";
import { audit } from "./audit";
import { emailRefund, emailStatusChanged } from "./emails";
import { maybeCompleteOrder } from "./fulfillment";

type Actor = Pick<User, "id" | "name"> | null;

export async function changeOrderStatus(actor: User, orderId: string, to: OrderStatus, note: string | null, notifyCustomer: boolean) {
  const order = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { deliveries: true } });
    if (!order) throw new UserError("Order not found.");
    if (!canTransition(order.status, to, { requiresShipping: order.requiresShipping, pickup: order.deliveryMethod === "PICKUP" })) {
      throw new UserError(`An order cannot go from “${ORDER_STATUS_LABELS[order.status]}” to “${ORDER_STATUS_LABELS[to]}”.`);
    }
    if (to === "COMPLETED" && order.paymentStatus !== "PAID" && order.paymentStatus !== "PARTIALLY_REFUNDED") {
      throw new UserError("Record or verify the payment before completing the order.");
    }
    if ((to === "COMPLETED" || to === "DELIVERED") && order.deliveries.some((d) => d.status === "PENDING" || d.status === "PROCESSING" || d.status === "FAILED")) {
      throw new UserError("Deliver all digital items before marking the order delivered or completed.");
    }
    const from = order.status;
    await setOrderStatus(tx, order, to, note, actor);
    await audit(actor, "order.status", "Order", orderId, `${order.number}: ${from} → ${to}${note ? ` (${note})` : ""}`, undefined, tx);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  if (notifyCustomer) await emailStatusChanged(order);
  return order;
}

/** Cancels an unpaid order (or rejects an unconfirmed one): returns stock, releases discount usage, voids pending payments. */
export async function cancelOrder(actor: Actor, orderId: string, reason: string, opts: { byCustomer?: boolean } = {}) {
  const trimmed = reason.trim();
  if (!trimmed) throw new UserError("Give a reason for cancelling.");
  const order = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, promotionUsages: true, deliveries: true } });
    if (!order) throw new UserError("Order not found.");
    const allowed = opts.byCustomer ? CUSTOMER_CANCELLABLE : CANCELLABLE;
    if (!allowed.includes(order.status)) throw new UserError(`Orders that are “${ORDER_STATUS_LABELS[order.status]}” cannot be cancelled${opts.byCustomer ? " online — please contact us" : ""}.`);
    if (opts.byCustomer && order.paymentStatus === "PENDING_VERIFICATION") throw new UserError("Your payment is being verified. Please contact us to cancel.");
    if (order.paidTotal - order.refundedTotal > 0) throw new UserError("This order has payments. Record a refund first, then cancel.");
    for (const item of order.items) {
      const toReturn = item.quantity - item.restockedQuantity - item.fulfilledQuantity;
      if (item.stockDeducted && item.variantId && toReturn > 0) {
        await restoreStock(tx, item.variantId, toReturn, "ORDER_CANCELLED", { orderId, actorId: actor?.id, note: trimmed });
        await tx.orderItem.update({ where: { id: item.id }, data: { stockDeducted: false } });
      }
    }
    for (const usage of order.promotionUsages) {
      await tx.promotion.update({ where: { id: usage.promotionId }, data: { usageCount: { decrement: 1 } } });
      await tx.promotionUsage.delete({ where: { id: usage.id } });
    }
    await tx.payment.updateMany({ where: { orderId, status: "PENDING" }, data: { status: "CANCELLED" } });
    for (const d of order.deliveries) {
      if (d.licenseKeyIds.length) await tx.licenseKey.updateMany({ where: { id: { in: d.licenseKeyIds } }, data: { status: "REVOKED" } });
    }
    await tx.digitalDelivery.updateMany({ where: { orderId, status: { not: "REVOKED" } }, data: { status: "REVOKED", failureReason: "Order cancelled" } });
    await tx.order.update({ where: { id: orderId }, data: { cancelReason: trimmed } });
    await setOrderStatus(tx, order, "CANCELLED", trimmed, actor);
    await refreshPaymentStatus(tx, orderId, actor, null);
    await audit(actor, opts.byCustomer ? "order.cancel_by_customer" : "order.cancel", "Order", orderId, `${order.number}: ${trimmed}`, undefined, tx);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  await emailStatusChanged(order);
  return order;
}

export async function addOrderNote(actor: User, orderId: string, body: string) {
  const text = body.trim();
  if (!text) throw new UserError("Write a note first.");
  await db.orderNote.create({ data: { orderId, authorId: actor.id, authorName: actor.name, body: text.slice(0, 5000) } });
}

/**
 * Records a refund. Money returned is tracked separately from revenue; items can optionally be returned to stock,
 * which also reverses their cost of goods sold. A fully refunded order becomes "Refunded".
 */
export async function createRefund(
  actor: User,
  orderId: string,
  input: { amount: number; reason: string; method: string | null; reference: string | null; items: { orderItemId: string; quantity: number; restock: boolean }[] },
) {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new UserError("Enter the refund amount.");
  if (!input.reason.trim()) throw new UserError("Give a reason for the refund.");
  const order = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new UserError("Order not found.");
    const refundable = order.paidTotal - order.refundedTotal;
    if (input.amount > refundable) throw new UserError(`You can refund at most ${(refundable / 100).toFixed(2)}.`);
    let cogsReversed = 0;
    const recorded: { orderItemId: string; quantity: number; restock: boolean }[] = [];
    for (const r of input.items.filter((i) => i.quantity > 0)) {
      const item = order.items.find((i) => i.id === r.orderItemId);
      if (!item) throw new UserError("Unknown order item.");
      if (!Number.isInteger(r.quantity) || r.quantity > item.quantity - item.refundedQuantity) throw new UserError(`Too many “${item.productTitle}” selected.`);
      const restock = r.restock && item.productType === "PHYSICAL" && item.stockDeducted && Boolean(item.variantId);
      await tx.orderItem.update({
        where: { id: item.id },
        data: {
          refundedQuantity: { increment: r.quantity },
          ...(restock ? { restockedQuantity: { increment: r.quantity }, fulfilledQuantity: Math.max(0, item.fulfilledQuantity - r.quantity) } : {}),
        },
      });
      if (restock) {
        await restoreStock(tx, item.variantId!, r.quantity, "RETURN_RESTOCK", { orderId, actorId: actor.id, note: input.reason });
        cogsReversed += item.unitCost * r.quantity;
      }
      if (item.productType !== "PHYSICAL" && item.refundedQuantity + r.quantity >= item.quantity) {
        const deliveries = await tx.digitalDelivery.findMany({ where: { orderItemId: item.id } });
        for (const d of deliveries) if (d.licenseKeyIds.length) await tx.licenseKey.updateMany({ where: { id: { in: d.licenseKeyIds } }, data: { status: "REVOKED" } });
        await tx.digitalDelivery.updateMany({ where: { orderItemId: item.id }, data: { status: "REVOKED", failureReason: "Refunded" } });
      }
      recorded.push({ orderItemId: item.id, quantity: r.quantity, restock });
    }
    await tx.refund.create({
      data: { orderId, amount: input.amount, reason: input.reason.trim(), method: input.method, reference: input.reference, items: recorded, cogsReversed, createdById: actor.id, createdByName: actor.name },
    });
    await refreshPaymentStatus(tx, orderId, actor, `Refund ${(input.amount / 100).toFixed(2)}: ${input.reason.trim()}`);
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    const target: OrderStatus = fresh.refundedTotal >= fresh.paidTotal ? "REFUNDED" : "PARTIALLY_REFUNDED";
    if (fresh.status !== target && fresh.status !== "CANCELLED") await setOrderStatus(tx, fresh, target, input.reason.trim(), actor);
    await addHistory(tx, orderId, "PAYMENT", null, "REFUND", `${(input.amount / 100).toFixed(2)} via ${input.method || "original method"}`, actor);
    await maybeCompleteOrder(tx, orderId, actor);
    await audit(actor, "refund.create", "Order", orderId, `${order.number}: refund ${(input.amount / 100).toFixed(2)} (${input.reason.trim()})`, undefined, tx);
    return tx.order.findUniqueOrThrow({ where: { id: orderId } });
  });
  await emailRefund(order, input.amount);
  return order;
}
