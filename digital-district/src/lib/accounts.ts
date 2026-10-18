import type { TokenType, UserRole } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { renderEmail, sendEmail } from "./email";
import { ROLE_LABELS } from "./permissions";

const TTL: Record<TokenType, number> = { EMAIL_VERIFICATION: 7 * 86400_000, PASSWORD_RESET: 3600_000 };

export async function createUserToken(userId: string, type: TokenType): Promise<string> {
  const token = randomToken();
  await db.userToken.deleteMany({ where: { userId, type, usedAt: null } });
  await db.userToken.create({ data: { userId, type, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TTL[type]) } });
  return token;
}

/** Returns the user id when the token is valid and unused, marking it used. */
export async function consumeUserToken(token: string, type: TokenType): Promise<string | null> {
  const row = await db.userToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.type !== type || row.usedAt || row.expiresAt < new Date()) return null;
  const claimed = await db.userToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return claimed.count ? row.userId : null;
}

export function passwordResetUrl(token: string) {
  return `${env.appUrl}/reset-password/${token}`;
}

export async function sendPasswordReset(user: { id: string; email: string; name: string }) {
  const token = await createUserToken(user.id, "PASSWORD_RESET");
  const url = passwordResetUrl(token);
  await sendEmail(user.email, "Reset your Digital District password", "password_reset", renderEmail({
    heading: "Reset your password",
    paragraphs: [`Hi ${user.name}, we received a request to reset your password. This link expires in one hour.`, "If you didn't ask for this, you can ignore this email — your password stays the same."],
    button: { label: "Choose a new password", url },
  }));
  return url;
}

export async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const token = await createUserToken(user.id, "EMAIL_VERIFICATION");
  await sendEmail(user.email, "Confirm your email address", "email_verification", renderEmail({
    heading: "Confirm your email",
    paragraphs: [`Welcome to Digital District, ${user.name}! Please confirm your email address so we can send you order updates.`],
    button: { label: "Confirm email", url: `${env.appUrl}/verify-email/${token}` },
  }));
}

export async function createStaffInvitation(email: string, role: UserRole, name: string | null, invitedById: string | null) {
  const token = randomToken();
  await db.staffInvitation.updateMany({ where: { email, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
  await db.staffInvitation.create({ data: { email, role, name, tokenHash: sha256(token), invitedById, expiresAt: new Date(Date.now() + 72 * 3600_000) } });
  const url = `${env.appUrl}/invite/${token}`;
  await sendEmail(email, "You're invited to the Digital District admin", "staff_invitation", renderEmail({
    heading: "Admin invitation",
    paragraphs: [`You have been invited to join the Digital District team as ${ROLE_LABELS[role]}. This invitation expires in 72 hours.`],
    button: { label: "Accept invitation", url },
  }));
  return url;
}

/** A safe redirect target: only same-site relative paths. */
export function safeNext(next: unknown, fallback = "/account"): string {
  const s = typeof next === "string" ? next : "";
  return s.startsWith("/") && !s.startsWith("//") && !s.startsWith("/\\") ? s : fallback;
}
