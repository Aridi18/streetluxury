"use server";

import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import type { PaymentAppliesTo, UserRole } from "@prisma/client";
import { db } from "@/lib/db";
import { getSession, hashPassword, passwordProblem, requireStaff, verifyPassword } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { audit } from "@/lib/audit";
import { decrypt, encrypt, generateTotpSecret, verifyTotp } from "@/lib/crypto";
import { createStaffInvitation } from "@/lib/accounts";
import { STAFF_ROLES } from "@/lib/permissions";
import { mpgsConfigured } from "@/lib/payments";
import { readSettings } from "@/lib/settings";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function savePaymentMethodAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("settings.manage");
    const id = s(f, "id");
    const method = await db.paymentMethod.findUniqueOrThrow({ where: { id } });
    const isEnabled = f.get("isEnabled") === "on";
    const instructions = s(f, "instructions");
    if (isEnabled && method.kind === "MANUAL" && !instructions) return { ok: false, error: `Add payment instructions (account number, name, steps) before enabling ${method.name}.` };
    if (isEnabled && method.kind === "ONLINE_CARD" && !mpgsConfigured()) return { ok: false, error: "Card payments need the payment gateway credentials set on the server first (see the deployment guide)." };
    const feePct = Number(s(f, "feePercent") || 0);
    const feeFixed = s(f, "feeFixed") ? parseMoney(s(f, "feeFixed")) : 0;
    if (!(feePct >= 0 && feePct < 100) || feeFixed == null) return { ok: false, error: "Enter valid fees." };
    await db.paymentMethod.update({
      where: { id },
      data: {
        name: s(f, "name") || method.name,
        description: s(f, "description") || null,
        instructions: instructions || null,
        isEnabled,
        appliesTo: (s(f, "appliesTo") || "ALL") as PaymentAppliesTo,
        requiresReference: f.get("requiresReference") === "on",
        allowProofUpload: f.get("allowProofUpload") === "on",
        feePercentBps: Math.round(feePct * 100),
        feeFixed,
        sortOrder: Number(s(f, "sortOrder")) || 0,
      },
    });
    await audit(user, "payment_method.update", "PaymentMethod", id, `${method.name}: ${isEnabled ? "enabled" : "disabled"}`);
    revalidatePath("/admin/payments");
    return { ok: true, message: "Payment method saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createPaymentMethodAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("settings.manage");
    const name = s(f, "name");
    if (!name) return { ok: false, error: "Enter a name." };
    const code = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30) + "-" + Date.now().toString(36);
    const kind = s(f, "kind") === "ARRANGED" ? "ARRANGED" : "MANUAL";
    const m = await db.paymentMethod.create({ data: { code, name, kind, isEnabled: false, requiresReference: kind === "MANUAL", allowProofUpload: kind === "MANUAL", sortOrder: 50 } });
    await audit(user, "payment_method.create", "PaymentMethod", m.id, `Added payment method ${name}`);
    revalidatePath("/admin/payments");
    return { ok: true, message: "Payment method added (disabled). Add instructions, then enable it." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveZoneAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("settings.manage");
    const id = s(f, "id") || undefined;
    if (f.get("delete") === "on" && id) {
      const used = await db.order.count({ where: { shippingZoneId: id } });
      if (used) await db.shippingZone.update({ where: { id }, data: { isActive: false } });
      else await db.shippingZone.delete({ where: { id } });
      await audit(user, "zone.delete", "ShippingZone", id, used ? "Disabled zone (used by orders)" : "Deleted zone");
      revalidatePath("/admin/shipping");
      return { ok: true, message: used ? "This area has past orders, so it was disabled instead of deleted." : "Area deleted." };
    }
    const fee = parseMoney(s(f, "fee") || "0");
    const threshold = s(f, "freeShippingThreshold") ? parseMoney(s(f, "freeShippingThreshold")) : null;
    if (fee == null || (s(f, "freeShippingThreshold") && threshold == null)) return { ok: false, error: "Enter valid amounts." };
    if (!s(f, "name")) return { ok: false, error: "Enter the area name." };
    const data = { name: s(f, "name"), fee, freeShippingThreshold: threshold, estimatedDelivery: s(f, "estimatedDelivery") || null, areas: s(f, "areas").split(",").map((a) => a.trim()).filter(Boolean), isActive: f.get("isActive") === "on", sortOrder: Number(s(f, "sortOrder")) || 0 };
    const z = id ? await db.shippingZone.update({ where: { id }, data }) : await db.shippingZone.create({ data });
    await audit(user, "zone.save", "ShippingZone", z.id, `${z.name}: fee ${fee / 100}${z.isActive ? "" : " (inactive)"}`);
    revalidatePath("/admin/shipping");
    return { ok: true, message: "Delivery area saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function inviteStaffAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("staff.manage");
    const email = s(f, "email").toLowerCase();
    const role = s(f, "role") as UserRole;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "Enter a valid email." };
    if (!STAFF_ROLES.includes(role)) return { ok: false, error: "Choose a role." };
    const url = await createStaffInvitation(email, role, s(f, "name") || null, user.id);
    await audit(user, "staff.invite", "StaffInvitation", email, `Invited ${email} as ${role}`);
    revalidatePath("/admin/staff");
    return { ok: true, message: `Invitation created (valid 72 hours, single use). It was emailed if email is set up — you can also send this link privately:\n${url}` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateStaffAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("staff.manage");
    const id = s(f, "id");
    const target = await db.user.findUniqueOrThrow({ where: { id } });
    const role = s(f, "role") as UserRole;
    const isActive = f.get("isActive") === "on";
    if (![...STAFF_ROLES, "CUSTOMER"].includes(role)) return { ok: false, error: "Choose a role." };
    if (target.id === user.id && (role !== "OWNER" || !isActive)) return { ok: false, error: "You can't remove your own owner access." };
    if (target.role === "OWNER" && (role !== "OWNER" || !isActive)) {
      const owners = await db.user.count({ where: { role: "OWNER", isActive: true, deletedAt: null } });
      if (owners <= 1) return { ok: false, error: "There must always be at least one active owner." };
    }
    await db.user.update({ where: { id }, data: { role, isActive } });
    if (!isActive || role !== target.role) await db.session.deleteMany({ where: { userId: id } });
    await audit(user, "staff.update", "User", id, `${target.email}: ${target.role} → ${role}${isActive ? "" : " (deactivated)"}`);
    revalidatePath("/admin/staff");
    return { ok: true, message: "Staff member updated. They were signed out so the change takes effect." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function revokeInvitationAction(f: FormData) {
  const user = await requireStaff("staff.manage");
  const inv = await db.staffInvitation.update({ where: { id: s(f, "id") }, data: { revokedAt: new Date() } });
  await audit(user, "staff.revoke_invitation", "StaffInvitation", inv.id, `Revoked invitation for ${inv.email}`);
  revalidatePath("/admin/staff");
}

// ───────────── Own security (two-step verification, password) ─────────────

export async function startTotpAction(_p: ActionResult<{ secret: string; qr: string }> | null): Promise<ActionResult<{ secret: string; qr: string }>> {
  try {
    const user = await requireStaff("dashboard.view", { allowWithout2fa: true });
    const secret = generateTotpSecret();
    await db.user.update({ where: { id: user.id }, data: { totpSecret: encrypt(secret), totpEnabledAt: null } });
    const settings = await readSettings();
    const uri = `otpauth://totp/${encodeURIComponent(`${settings.storeName}:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent(settings.storeName)}&algorithm=SHA1&digits=6&period=30`;
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 });
    return { ok: true, data: { secret, qr } };
  } catch (err) {
    return toActionError(err);
  }
}

export async function confirmTotpAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("dashboard.view", { allowWithout2fa: true });
    const fresh = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!fresh.totpSecret) return { ok: false, error: "Start the setup again." };
    if (!verifyTotp(decrypt(fresh.totpSecret), s(f, "code"))) return { ok: false, error: "That code is not correct. Make sure your phone's time is set automatically and try again." };
    await db.user.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    const session = await getSession();
    await db.session.deleteMany({ where: { userId: user.id, id: { not: session?.id } } });
    await audit(user, "security.totp_enable", "User", user.id, "Enabled two-step verification");
    revalidatePath("/admin", "layout");
    return { ok: true, message: "Two-step verification is on. You'll be asked for a code each time you sign in." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function disableTotpAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("dashboard.view", { allowWithout2fa: true });
    if (!(await verifyPassword(s(f, "password"), user.passwordHash))) return { ok: false, error: "Password is not correct." };
    if ((await readSettings()).require2faForStaff) return { ok: false, error: "Two-step verification is required for staff in this store." };
    await db.user.update({ where: { id: user.id }, data: { totpSecret: null, totpEnabledAt: null } });
    await audit(user, "security.totp_disable", "User", user.id, "Disabled two-step verification");
    revalidatePath("/admin/security");
    return { ok: true, message: "Two-step verification turned off." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function staffPasswordAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("dashboard.view", { allowWithout2fa: true });
    if (!(await verifyPassword(s(f, "current"), user.passwordHash))) return { ok: false, error: "Current password is not correct." };
    if (s(f, "password") !== s(f, "confirm")) return { ok: false, error: "The new passwords don't match." };
    const problem = passwordProblem(s(f, "password"));
    if (problem) return { ok: false, error: problem };
    const session = await getSession();
    await db.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(s(f, "password")) } });
    await db.session.deleteMany({ where: { userId: user.id, id: { not: session?.id } } });
    await audit(user, "security.password_change", "User", user.id, "Changed password");
    return { ok: true, message: "Password changed." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function markNotificationsReadAction() {
  const user = await requireStaff("dashboard.view");
  const { permissionsFor } = await import("@/lib/permissions");
  await db.notification.updateMany({ where: { readAt: null, permission: { in: [...permissionsFor(user.role)] } }, data: { readAt: new Date() } });
  revalidatePath("/admin", "layout");
}
