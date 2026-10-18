"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { clientInfo, createSession, destroySession, getSession, hashPassword, passwordProblem, verifyPassword } from "@/lib/auth";
import { mergeGuestCart } from "@/lib/cart";
import { rateLimit } from "@/lib/ratelimit";
import { toActionError, type ActionResult } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { consumeUserToken, safeNext, sendPasswordReset, sendVerificationEmail } from "@/lib/accounts";
import { decrypt, sha256, verifyTotp } from "@/lib/crypto";
import { isStaffRole } from "@/lib/permissions";
import { audit } from "@/lib/audit";
import { emailConfigured } from "@/lib/email";

const email = z.email("Enter a valid email address.").transform((e) => e.trim().toLowerCase());

export async function loginAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let next: string;
  try {
    const parsed = z.object({ email, password: z.string().min(1, "Enter your password.").max(200) }).safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const { ip } = await clientInfo();
    await rateLimit(`login:${ip}`, 30, 900);
    await rateLimit(`login:${parsed.data.email}`, 8, 900);
    const user = await db.user.findUnique({ where: { email: parsed.data.email } });
    const valid = await verifyPassword(parsed.data.password, user?.passwordHash);
    if (!user || !valid || !user.isActive || user.deletedAt) return { ok: false, error: "Incorrect email or password." };
    await createSession(user);
    if (isStaffRole(user.role)) await audit(user, "auth.login", "User", user.id, "Staff sign-in");
    next = safeNext(formData.get("next"), isStaffRole(user.role) ? "/admin" : "/account");
    if (user.totpEnabledAt) {
      redirect(`/login/two-factor?next=${encodeURIComponent(next)}`);
    }
    await mergeGuestCart(user.id);
  } catch (err) {
    return toActionError(err);
  }
  redirect(next);
}

export async function twoFactorAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let next: string;
  try {
    const session = await getSession();
    if (!session || !session.totpPending || !session.user.totpSecret) return { ok: false, error: "Your sign-in expired. Please sign in again." };
    await rateLimit(`totp:${session.user.id}`, 6, 300);
    if (!verifyTotp(decrypt(session.user.totpSecret), String(formData.get("code") ?? ""))) return { ok: false, error: "That code is not correct. Check your authenticator app and try again." };
    await db.session.update({ where: { id: session.id }, data: { totpPending: false } });
    await mergeGuestCart(session.user.id);
    next = safeNext(formData.get("next"), "/admin");
  } catch (err) {
    return toActionError(err);
  }
  redirect(next);
}

const registerSchema = z
  .object({
    name: z.string().trim().min(2, "Enter your name.").max(120),
    email,
    phone: z.string().trim().max(40).optional(),
    password: z.string(),
    confirm: z.string(),
    marketing: z.string().optional(),
  })
  .refine((d) => d.password === d.confirm, { message: "The passwords don't match.", path: ["confirm"] });

export async function registerAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let next: string;
  try {
    if (formData.get("website")) return { ok: false, error: "Something went wrong." };
    const parsed = registerSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const problem = passwordProblem(parsed.data.password);
    if (problem) return { ok: false, error: problem };
    const phone = parsed.data.phone ? normalizePhone(parsed.data.phone) : null;
    if (parsed.data.phone && !phone) return { ok: false, error: "Enter a valid phone number." };
    const { ip } = await clientInfo();
    await rateLimit(`register:${ip}`, 5, 3600);
    if (await db.user.findUnique({ where: { email: parsed.data.email } })) return { ok: false, error: "An account with this email already exists. Try signing in or resetting your password." };
    const user = await db.user.create({
      data: { name: parsed.data.name, email: parsed.data.email, phone, passwordHash: await hashPassword(parsed.data.password), marketingOptIn: parsed.data.marketing === "on" },
    });
    // Link earlier guest orders placed with the same email so they appear in the account.
    await db.order.updateMany({ where: { userId: null, email: user.email }, data: { userId: user.id } });
    await createSession(user);
    await mergeGuestCart(user.id);
    await sendVerificationEmail(user);
    next = safeNext(formData.get("next"), "/account");
  } catch (err) {
    return toActionError(err);
  }
  redirect(next);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function forgotPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const parsed = email.safeParse(formData.get("email"));
    if (!parsed.success) return { ok: false, error: "Enter a valid email address." };
    const { ip } = await clientInfo();
    await rateLimit(`forgot:${ip}`, 5, 3600);
    const user = await db.user.findUnique({ where: { email: parsed.data } });
    if (user && user.isActive && !user.deletedAt) await sendPasswordReset(user);
    return {
      ok: true,
      message: emailConfigured()
        ? "If an account exists for that email, we've sent a link to reset your password. It expires in one hour."
        : "Password reset emails aren't available right now. Please message us on WhatsApp and we'll send you a secure reset link.",
    };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetPasswordAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const password = String(formData.get("password") ?? "");
    if (password !== String(formData.get("confirm") ?? "")) return { ok: false, error: "The passwords don't match." };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
    const userId = await consumeUserToken(String(formData.get("token") ?? ""), "PASSWORD_RESET");
    if (!userId) return { ok: false, error: "This reset link is invalid or has expired. Please request a new one." };
    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(password) } });
    await db.session.deleteMany({ where: { userId } });
    return { ok: true, message: "Your password has been changed. You can now sign in." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function acceptInvitationAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const token = String(formData.get("token") ?? "");
    const invite = await db.staffInvitation.findUnique({ where: { tokenHash: sha256(token) } });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date()) return { ok: false, error: "This invitation is invalid or has expired. Ask the owner for a new one." };
    const name = String(formData.get("name") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    if (name.length < 2) return { ok: false, error: "Enter your name." };
    if (password !== String(formData.get("confirm") ?? "")) return { ok: false, error: "The passwords don't match." };
    const problem = passwordProblem(password);
    if (problem) return { ok: false, error: problem };
    const passwordHash = await hashPassword(password);
    const claimed = await db.staffInvitation.updateMany({ where: { id: invite.id, acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (!claimed.count) return { ok: false, error: "This invitation has already been used." };
    const user = await db.user.upsert({
      where: { email: invite.email },
      create: { email: invite.email, name, role: invite.role, passwordHash, emailVerifiedAt: new Date() },
      update: { name, role: invite.role, passwordHash, isActive: true, emailVerifiedAt: new Date() },
    });
    await db.session.deleteMany({ where: { userId: user.id } });
    await audit(user, "staff.accept_invitation", "User", user.id, `Joined as ${invite.role}`);
    return { ok: true, message: "Your admin account is ready. Sign in to continue." };
  } catch (err) {
    return toActionError(err);
  }
}
