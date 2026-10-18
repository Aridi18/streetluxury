import { createHmac } from "node:crypto";
import type { OrderStatus, PaymentStatus, StatusKind, User } from "@prisma/client";
import { type Tx } from "./db";
import { env } from "./env";
import { safeEqual } from "./crypto";
import { derivePaymentStatus } from "./order-status";

type Actor = Pick<User, "id" | "name"> | null;

/** Secret key that lets a guest open their own order page (derived, so it never needs to be stored). */
export function orderAccessKey(orderId: string): string {
  return createHmac("sha256", env.encryptionKey).update(`order-access:${orderId}`).digest("base64url").slice(0, 32);
}

export function verifyOrderAccessKey(orderId: string, key: string | null | undefined): boolean {
  return Boolean(key) && safeEqual(orderAccessKey(orderId), key!);
}

export function orderUrl(order: { id: string; number: string }): string {
  return `${env.appUrl}/order/${order.number}?key=${orderAccessKey(order.id)}`;
}

export async function addHistory(tx: Tx, orderId: string, kind: StatusKind, from: string | null, to: string, note: string | null, actor: Actor) {
  await tx.orderStatusHistory.create({
    data: { orderId, kind, fromStatus: from, toStatus: to, note, actorId: actor?.id ?? null, actorName: actor?.name ?? "System" },
  });
}

export async function setOrderStatus(tx: Tx, order: { id: string; status: OrderStatus }, to: OrderStatus, note: string | null, actor: Actor) {
  if (order.status === to) return;
  const now = new Date();
  await tx.order.update({
    where: { id: order.id },
    data: {
      status: to,
      ...(to === "CONFIRMED" ? { confirmedAt: now, expiresAt: null } : {}),
      ...(to === "COMPLETED" ? { completedAt: now } : {}),
      ...(to === "CANCELLED" ? { cancelledAt: now, expiresAt: null } : {}),
    },
  });
  await addHistory(tx, order.id, "ORDER", order.status, to, note, actor);
  order.status = to;
}

/**
 * Recalculates paid/refunded totals and the payment status from the payment and refund records.
 * Returns whether the order became fully paid for the first time (the revenue recognition moment).
 */
export async function refreshPaymentStatus(tx: Tx, orderId: string, actor: Actor, note: string | null) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: "asc" } }, refunds: true } });
  const paidTotal = order.payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + p.amount, 0);
  const refundedTotal = order.refunds.reduce((s, r) => s + r.amount, 0);
  const last = order.payments[order.payments.length - 1];
  const next: PaymentStatus = derivePaymentStatus({
    total: order.total,
    paidTotal,
    refundedTotal,
    hasPending: order.payments.some((p) => p.status === "PENDING" && p.provider === "manual"),
    lastFailed: last?.status === "FAILED",
  });
  const becamePaid = !order.paidAt && paidTotal >= order.total && order.status !== "CANCELLED";
  await tx.order.update({
    where: { id: orderId },
    data: { paidTotal, refundedTotal, paymentStatus: next, ...(becamePaid ? { paidAt: new Date() } : {}) },
  });
  if (next !== order.paymentStatus) await addHistory(tx, orderId, "PAYMENT", order.paymentStatus, next, note, actor);
  return { becamePaid, paymentStatus: next, previous: order.paymentStatus };
}
