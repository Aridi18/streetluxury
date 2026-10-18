"use server";

import { revalidatePath } from "next/cache";
import type { OrderStatus, ShipmentStatus } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { addOrderNote, cancelOrder, changeOrderStatus, createRefund } from "@/lib/orders";
import { recordPayment, rejectPayment, verifyPayment } from "@/lib/payments";
import { createShipment, deliverManually, retryAutoDelivery, setDeliveryState, updateShipmentStatus } from "@/lib/fulfillment";
import { db } from "@/lib/db";

const done = (orderId: string, message: string): ActionResult => {
  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath("/admin/orders");
  return { ok: true, message };
};
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const optDate = (v: string) => (v ? new Date(`${v}T12:00:00Z`) : null);

export async function changeStatusAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.manage");
    await changeOrderStatus(user, str(f, "orderId"), str(f, "status") as OrderStatus, str(f, "note") || null, f.get("notify") === "on");
    return done(str(f, "orderId"), "Status updated.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function cancelOrderAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.manage");
    await cancelOrder(user, str(f, "orderId"), str(f, "reason"));
    return done(str(f, "orderId"), "Order cancelled and stock returned.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function addNoteAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.view");
    await addOrderNote(user, str(f, "orderId"), str(f, "body"));
    return done(str(f, "orderId"), "Note added.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function verifyPaymentAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("payments.verify");
    const amount = str(f, "amount") ? parseMoney(str(f, "amount")) : undefined;
    if (amount === null) return { ok: false, error: "Enter a valid amount." };
    await verifyPayment(user, str(f, "paymentId"), { amount, note: str(f, "note") || null });
    return done(str(f, "orderId"), "Payment verified.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function rejectPaymentAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("payments.verify");
    await rejectPayment(user, str(f, "paymentId"), str(f, "reason"));
    return done(str(f, "orderId"), "Payment rejected and customer notified.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function recordPaymentAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("payments.verify");
    const amount = parseMoney(str(f, "amount"));
    if (!amount) return { ok: false, error: "Enter the amount received." };
    await recordPayment(user, str(f, "orderId"), { amount, methodId: str(f, "methodId") || null, reference: str(f, "reference") || null, note: str(f, "note") || null });
    return done(str(f, "orderId"), "Payment recorded.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function refundAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("refunds.manage");
    const amount = parseMoney(str(f, "amount"));
    if (!amount) return { ok: false, error: "Enter the refund amount." };
    const orderId = str(f, "orderId");
    const items = (await db.orderItem.findMany({ where: { orderId } })).map((i) => ({
      orderItemId: i.id,
      quantity: Number(str(f, `qty_${i.id}`) || 0),
      restock: f.get(`restock_${i.id}`) === "on",
    }));
    await createRefund(user, orderId, { amount, reason: str(f, "reason"), method: str(f, "method") || null, reference: str(f, "reference") || null, items });
    return done(orderId, "Refund recorded.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function createShipmentAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.fulfill");
    const orderId = str(f, "orderId");
    const lines = await db.orderItem.findMany({ where: { orderId, productType: "PHYSICAL" } });
    const cost = str(f, "shippingCost") ? parseMoney(str(f, "shippingCost")) : 0;
    if (cost === null) return { ok: false, error: "Enter a valid courier cost." };
    await createShipment(user, orderId, {
      items: lines.map((l) => ({ orderItemId: l.id, quantity: Number(str(f, `ship_${l.id}`) || 0) })),
      courier: str(f, "courier") || null,
      trackingNumber: str(f, "trackingNumber") || null,
      trackingUrl: str(f, "trackingUrl") || null,
      shippingCost: cost,
      status: (str(f, "status") || "SHIPPED") as "PREPARING" | "SHIPPED" | "READY_FOR_PICKUP",
      note: str(f, "note") || null,
    });
    return done(orderId, "Shipment created.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function shipmentStatusAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.fulfill");
    await updateShipmentStatus(user, str(f, "shipmentId"), str(f, "status") as ShipmentStatus, {
      courier: str(f, "courier") || undefined,
      trackingNumber: str(f, "trackingNumber") || undefined,
      trackingUrl: str(f, "trackingUrl") || undefined,
    });
    return done(str(f, "orderId"), "Shipment updated.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function deliverAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.fulfill");
    await deliverManually(user, str(f, "deliveryId"), { content: str(f, "content"), startsAt: optDate(str(f, "startsAt")), expiresAt: optDate(str(f, "expiresAt")), internalNote: str(f, "internalNote") || null });
    return done(str(f, "orderId"), "Delivered — the customer can now see the details on their order page.");
  } catch (err) {
    return toActionError(err);
  }
}

export async function deliveryStateAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("orders.fulfill");
    const state = str(f, "state");
    if (state === "RETRY") {
      const n = await retryAutoDelivery(user, str(f, "deliveryId"));
      return done(str(f, "orderId"), n ? "Delivered automatically." : "Automatic delivery is still not possible — check licence keys or files.");
    }
    await setDeliveryState(user, str(f, "deliveryId"), state as "PROCESSING" | "FAILED" | "REVOKED" | "PENDING", str(f, "reason") || null);
    return done(str(f, "orderId"), "Delivery updated.");
  } catch (err) {
    return toActionError(err);
  }
}
