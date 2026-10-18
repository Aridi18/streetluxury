"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { destroySession, getSession, hashPassword, passwordProblem, requireUser, verifyPassword } from "@/lib/auth";
import { addToCart } from "@/lib/cart";
import { normalizePhone } from "@/lib/phone";
import { rateLimit } from "@/lib/ratelimit";
import { toActionError, UserError, type ActionResult } from "@/lib/errors";
import { sendVerificationEmail } from "@/lib/accounts";
import { notifyStaff } from "@/lib/notifications";

export async function updateProfileAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const name = String(formData.get("name") ?? "").trim();
    if (name.length < 2 || name.length > 120) return { ok: false, error: "Enter your name." };
    const rawPhone = String(formData.get("phone") ?? "").trim();
    const phone = rawPhone ? normalizePhone(rawPhone) : null;
    if (rawPhone && !phone) return { ok: false, error: "Enter a valid phone number." };
    await db.user.update({ where: { id: user.id }, data: { name, phone, marketingOptIn: formData.get("marketing") === "on" } });
    revalidatePath("/account", "layout");
    return { ok: true, message: "Profile saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resendVerificationAction(): Promise<void> {
  const user = await requireUser();
  await rateLimit(`verify-resend:${user.id}`, 3, 3600).catch(() => undefined);
  if (!user.emailVerifiedAt) await sendVerificationEmail(user);
  revalidatePath("/account");
}

export async function changePasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await rateLimit(`password-change:${user.id}`, 5, 900);
    if (!(await verifyPassword(String(formData.get("current") ?? ""), user.passwordHash))) return { ok: false, error: "Your current password is not correct." };
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("confirm") ?? "")) return { ok: false, error: "The new passwords don't match." };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
    const session = await getSession();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
    await db.session.deleteMany({ where: { userId: user.id, id: { not: session?.id } } });
    return { ok: true, message: "Password changed. Other devices have been signed out." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function signOutOthersAction() {
  const user = await requireUser();
  const session = await getSession();
  await db.session.deleteMany({ where: { userId: user.id, id: { not: session?.id } } });
  revalidatePath("/account/security");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

const addressSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().max(40).optional(),
  fullName: z.string().trim().min(2, "Enter the recipient's name.").max(120),
  phone: z.string().trim().min(6, "Enter a phone number.").max(40),
  city: z.string().trim().min(2, "Enter the city.").max(120),
  area: z.string().trim().max(120).optional(),
  addressLine: z.string().trim().min(3, "Enter the street address.").max(300),
  building: z.string().trim().max(120).optional(),
  floor: z.string().trim().max(40).optional(),
  instructions: z.string().trim().max(500).optional(),
  isDefault: z.string().optional(),
});

export async function saveAddressAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    const parsed = addressSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { id, isDefault, ...d } = parsed.data;
    const phone = normalizePhone(d.phone);
    if (!phone) return { ok: false, error: "Enter a valid phone number." };
    const data = { ...d, phone, label: d.label || null, area: d.area || null, building: d.building || null, floor: d.floor || null, instructions: d.instructions || null };
    await db.$transaction(async (tx) => {
      const makeDefault = isDefault === "on" || (await tx.address.count({ where: { userId: user.id } })) === 0;
      if (makeDefault) await tx.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } });
      if (id) {
        const updated = await tx.address.updateMany({ where: { id, userId: user.id }, data: { ...data, ...(makeDefault ? { isDefault: true } : {}) } });
        if (!updated.count) throw new UserError("Address not found.");
      } else {
        await tx.address.create({ data: { ...data, userId: user.id, isDefault: makeDefault } });
      }
    });
    revalidatePath("/account/addresses");
    return { ok: true, message: "Address saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteAddressAction(formData: FormData) {
  const user = await requireUser();
  await db.address.deleteMany({ where: { id: String(formData.get("id")), userId: user.id } });
  revalidatePath("/account/addresses");
}

export async function setDefaultAddressAction(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("id"));
  await db.$transaction([
    db.address.updateMany({ where: { userId: user.id }, data: { isDefault: false } }),
    db.address.updateMany({ where: { id, userId: user.id }, data: { isDefault: true } }),
  ]);
  revalidatePath("/account/addresses");
}

/** Adds the items of a past order back to the cart at today's prices (skipping anything no longer sold). */
export async function reorderAction(formData: FormData) {
  const user = await requireUser();
  const order = await db.order.findFirst({ where: { id: String(formData.get("orderId")), userId: user.id }, include: { items: true } });
  if (!order) redirect("/account/orders");
  let skipped = 0;
  for (const item of order.items) {
    if (!item.variantId) {
      skipped++;
      continue;
    }
    try {
      await addToCart({ variantId: item.variantId, quantity: item.quantity, customFields: (item.customFields ?? {}) as Record<string, string> });
    } catch {
      skipped++;
    }
  }
  revalidatePath("/", "layout");
  redirect(`/cart${skipped ? `?error=${encodeURIComponent(`${skipped} item(s) from your previous order are no longer available and were skipped.`)}` : ""}`);
}

const supportSchema = z.object({
  type: z.enum(["SUPPORT", "RETURN", "PRIVACY_EXPORT", "PRIVACY_DELETION"]),
  orderNumber: z.string().trim().max(20).optional(),
  subject: z.string().trim().min(3, "Add a subject.").max(160),
  message: z.string().trim().min(10, "Tell us a bit more (at least 10 characters).").max(4000),
});

export async function supportRequestAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await requireUser();
    await rateLimit(`support:${user.id}`, 10, 3600);
    const parsed = supportSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const order = parsed.data.orderNumber ? await db.order.findFirst({ where: { number: parsed.data.orderNumber, userId: user.id } }) : null;
    if (parsed.data.orderNumber && !order) return { ok: false, error: "We couldn't find that order in your account." };
    const req = await db.supportRequest.create({
      data: { type: parsed.data.type, userId: user.id, orderId: order?.id, name: user.name, email: user.email, phone: user.phone, subject: parsed.data.subject, message: parsed.data.message },
    });
    await notifyStaff({ type: "support", title: `${parsed.data.type === "RETURN" ? "Return request" : parsed.data.type.startsWith("PRIVACY") ? "Privacy request" : "Support request"}: ${parsed.data.subject}`, body: user.name, link: `/admin/support/${req.id}`, permission: "support.manage" });
    revalidatePath("/account/support");
    return { ok: true, message: "Your request has been sent. We'll get back to you soon." };
  } catch (err) {
    return toActionError(err);
  }
}
