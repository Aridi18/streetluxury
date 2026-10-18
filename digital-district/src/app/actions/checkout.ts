"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientInfo, getCurrentUser } from "@/lib/auth";
import { findCart } from "@/lib/cart";
import { placeOrder } from "@/lib/checkout";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/ratelimit";
import { toActionError, type ActionResult } from "@/lib/errors";

const schema = z.object({
  idempotencyKey: z.uuid(),
  mode: z.enum(["website", "whatsapp"]),
  name: z.string().trim().min(2, "Enter your full name.").max(120),
  phone: z.string().trim().min(6, "Enter your phone number.").max(40),
  email: z.union([z.literal(""), z.email("Enter a valid email address.")]).optional(),
  preferredContact: z.enum(["WHATSAPP", "PHONE", "EMAIL"]).default("WHATSAPP"),
  deliveryMethod: z.enum(["DELIVERY", "PICKUP", "NONE"]).default("NONE"),
  zoneId: z.string().max(40).optional(),
  city: z.string().trim().max(120).optional(),
  area: z.string().trim().max(120).optional(),
  address: z.string().trim().max(300).optional(),
  instructions: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  paymentMethodId: z.string().max(40).optional(),
  saveAddress: z.string().optional(),
  acceptTerms: z.literal("on", { error: "Please accept the terms and conditions." }),
});

export async function placeOrderAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let destination: string;
  try {
    const parsed = schema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return { ok: false, error: issue.message, fieldErrors: { [String(issue.path[0])]: issue.message } };
    }
    const d = parsed.data;
    const phone = normalizePhone(d.phone);
    if (!phone) return { ok: false, error: "Enter a valid phone number (for example 81 745 567 or +44 7700 900123).", fieldErrors: { phone: "Invalid phone number" } };
    const email = d.email ? d.email.toLowerCase() : null;
    if (d.preferredContact === "EMAIL" && !email) return { ok: false, error: "Add your email address, or choose WhatsApp or phone as your contact method." };

    const { ip } = await clientInfo();
    await rateLimit(`checkout:${ip}`, 15, 600);
    const [cart, user] = await Promise.all([findCart(), getCurrentUser()]);
    if (!cart) return { ok: false, error: "Your cart is empty." };

    const placed = await placeOrder({
      cartId: cart.id,
      userId: user?.id ?? null,
      idempotencyKey: d.idempotencyKey,
      source: d.mode === "whatsapp" ? "WHATSAPP" : "WEBSITE",
      customerName: d.name,
      email,
      phone,
      preferredContact: d.preferredContact,
      deliveryMethod: d.deliveryMethod,
      zoneId: d.zoneId || null,
      city: d.city || null,
      area: d.area || null,
      address: d.address || null,
      instructions: d.instructions || null,
      customerNote: d.note || null,
      paymentMethodId: d.mode === "whatsapp" ? null : d.paymentMethodId || null,
      ip,
    });

    if (user && d.saveAddress === "on" && d.deliveryMethod === "DELIVERY" && d.city && d.address) {
      const exists = await db.address.findFirst({ where: { userId: user.id, addressLine: d.address, city: d.city } });
      if (!exists) {
        const count = await db.address.count({ where: { userId: user.id } });
        await db.address.create({ data: { userId: user.id, fullName: d.name, phone, city: d.city, area: d.area || null, addressLine: d.address, instructions: d.instructions || null, isDefault: count === 0 } });
      }
    }
    if (user && !user.phone) await db.user.update({ where: { id: user.id }, data: { phone } });

    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { paymentMethod: true } });
    destination =
      order.paymentMethod?.kind === "ONLINE_CARD" && order.paymentStatus !== "PAID"
        ? `/order/${placed.number}/pay?key=${placed.accessKey}`
        : `/order/${placed.number}?key=${placed.accessKey}&placed=1${d.mode === "whatsapp" ? "&wa=1" : ""}`;
  } catch (err) {
    return toActionError(err);
  }
  redirect(destination);
}
