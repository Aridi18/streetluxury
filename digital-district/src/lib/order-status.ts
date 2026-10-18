// Order and payment status rules. Pure and shared by server and UI.
import type { OrderStatus, PaymentStatus } from "@prisma/client";

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "Pending confirmation",
  AWAITING_PAYMENT: "Awaiting payment",
  CONFIRMED: "Confirmed",
  PROCESSING: "Processing",
  PARTIALLY_FULFILLED: "Partially fulfilled",
  SHIPPED: "Shipped",
  READY_FOR_PICKUP: "Ready for pickup",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  UNPAID: "Unpaid",
  PENDING_VERIFICATION: "Pending verification",
  PARTIALLY_PAID: "Partially paid",
  PAID: "Paid",
  FAILED: "Failed",
  REFUNDED: "Refunded",
  PARTIALLY_REFUNDED: "Partially refunded",
};

export type Tone = "neutral" | "info" | "warning" | "success" | "danger" | "accent";

export const ORDER_STATUS_TONE: Record<OrderStatus, Tone> = {
  PENDING: "warning",
  AWAITING_PAYMENT: "warning",
  CONFIRMED: "info",
  PROCESSING: "info",
  PARTIALLY_FULFILLED: "accent",
  SHIPPED: "accent",
  READY_FOR_PICKUP: "accent",
  DELIVERED: "success",
  COMPLETED: "success",
  CANCELLED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = {
  UNPAID: "warning",
  PENDING_VERIFICATION: "accent",
  PARTIALLY_PAID: "info",
  PAID: "success",
  FAILED: "danger",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
};

/**
 * Allowed manual status changes. Cancellation and refunds have their own actions (they release stock / record money),
 * so CANCELLED, REFUNDED and PARTIALLY_REFUNDED never appear as targets here.
 */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ["AWAITING_PAYMENT", "CONFIRMED", "PROCESSING"],
  AWAITING_PAYMENT: ["CONFIRMED", "PROCESSING"],
  CONFIRMED: ["PROCESSING", "PARTIALLY_FULFILLED", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "COMPLETED"],
  PROCESSING: ["PARTIALLY_FULFILLED", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "COMPLETED"],
  PARTIALLY_FULFILLED: ["PROCESSING", "SHIPPED", "READY_FOR_PICKUP", "DELIVERED", "COMPLETED"],
  SHIPPED: ["DELIVERED", "COMPLETED"],
  READY_FOR_PICKUP: ["DELIVERED", "COMPLETED"],
  DELIVERED: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
  PARTIALLY_REFUNDED: ["PROCESSING", "SHIPPED", "DELIVERED", "COMPLETED"],
};

export function allowedTransitions(from: OrderStatus, opts: { requiresShipping: boolean; pickup: boolean }): OrderStatus[] {
  return TRANSITIONS[from].filter((to) => {
    if (to === "SHIPPED" || to === "PARTIALLY_FULFILLED") return opts.requiresShipping && !opts.pickup;
    if (to === "READY_FOR_PICKUP") return opts.pickup;
    return true;
  });
}

export function canTransition(from: OrderStatus, to: OrderStatus, opts: { requiresShipping: boolean; pickup: boolean }): boolean {
  return allowedTransitions(from, opts).includes(to);
}

export const CANCELLABLE: OrderStatus[] = ["PENDING", "AWAITING_PAYMENT", "CONFIRMED", "PROCESSING"];

/** Statuses customers may cancel themselves (nothing has been paid or prepared yet). */
export const CUSTOMER_CANCELLABLE: OrderStatus[] = ["PENDING", "AWAITING_PAYMENT"];

export function derivePaymentStatus(o: { total: number; paidTotal: number; refundedTotal: number; hasPending: boolean; lastFailed: boolean }): PaymentStatus {
  if (o.refundedTotal > 0) return o.refundedTotal >= o.paidTotal ? "REFUNDED" : "PARTIALLY_REFUNDED";
  if (o.paidTotal >= o.total && (o.total > 0 || o.paidTotal > 0)) return "PAID";
  if (o.total === 0) return "PAID";
  if (o.hasPending) return "PENDING_VERIFICATION";
  if (o.paidTotal > 0) return "PARTIALLY_PAID";
  if (o.lastFailed) return "FAILED";
  return "UNPAID";
}
