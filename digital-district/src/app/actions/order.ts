"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { cancelOrder } from "@/lib/orders";
import { submitManualPayment } from "@/lib/payments";
import { savePaymentProof } from "@/lib/storage";
import { loadOrderForViewer } from "@/lib/order-access";
import { clientInfo } from "@/lib/auth";
import { rateLimit } from "@/lib/ratelimit";
import { toActionError, type ActionResult } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { orderAccessKey } from "@/lib/order-core";

export async function submitPaymentAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { ip } = await clientInfo();
    await rateLimit(`payment-submit:${ip}`, 10, 3600);
    const access = await loadOrderForViewer(String(formData.get("number")), String(formData.get("key") ?? ""));
    if (!access) return { ok: false, error: "Order not found." };
    const file = formData.get("proof");
    const proof = file instanceof File && file.size > 0 ? await savePaymentProof(file) : null;
    await submitManualPayment(access.order.id, { reference: String(formData.get("reference") ?? ""), proof });
    revalidatePath(`/order/${access.order.number}`);
    return { ok: true, message: "Thank you — we received your payment details and will verify them shortly." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function customerCancelAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const access = await loadOrderForViewer(String(formData.get("number")), String(formData.get("key") ?? ""));
    if (!access) return { ok: false, error: "Order not found." };
    const reason = String(formData.get("reason") ?? "").trim() || "Cancelled by the customer";
    await cancelOrder(access.viewer.user ? { id: access.viewer.user.id, name: access.viewer.user.name } : null, access.order.id, reason, { byCustomer: true });
    revalidatePath(`/order/${access.order.number}`);
    return { ok: true, message: "Your order has been cancelled." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function lookupOrderAction(_prev: ActionResult<{ url: string }> | null, formData: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const { ip } = await clientInfo();
    await rateLimit(`order-lookup:${ip}`, 10, 900);
    const number = String(formData.get("number") ?? "").trim().toUpperCase().replace(/^(\d)/, "DD-$1");
    const contact = String(formData.get("contact") ?? "").trim().toLowerCase();
    if (!number || !contact) return { ok: false, error: "Enter your order number and the phone or email used for the order." };
    const order = await db.order.findUnique({ where: { number } });
    const matches = order && ((order.email && order.email.toLowerCase() === contact) || normalizePhone(contact) === order.phone);
    if (!order || !matches) return { ok: false, error: "We couldn't find an order with those details." };
    return { ok: true, data: { url: `/order/${order.number}?key=${orderAccessKey(order.id)}` } };
  } catch (err) {
    return toActionError(err);
  }
}
