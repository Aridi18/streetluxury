import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { User } from "@prisma/client";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { hasPermission, isStaffRole, type Permission } from "./permissions";

export const SESSION_COOKIE = "dd_session";
const CUSTOMER_SESSION_DAYS = 30;
const STAFF_SESSION_HOURS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

let dummyHash: string | undefined;

export async function verifyPassword(password: string, hash: string | null | undefined): Promise<boolean> {
  if (!hash) {
    // Spend the same time as a real check so response timing does not reveal which emails exist.
    dummyHash ??= await bcrypt.hash("not-a-real-password", 12);
    await bcrypt.compare(password, dummyHash);
    return false;
  }
  return bcrypt.compare(password, hash);
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Use at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use both letters and numbers.";
  return null;
}

export async function clientInfo() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  return { ip, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export async function createSession(user: Pick<User, "id" | "role" | "totpEnabledAt">) {
  const token = randomToken();
  const staff = isStaffRole(user.role);
  const ttlMs = staff ? STAFF_SESSION_HOURS * 3600_000 : CUSTOMER_SESSION_DAYS * 86400_000;
  const { ip, userAgent } = await clientInfo();
  await db.session.create({
    data: {
      id: sha256(token),
      userId: user.id,
      expiresAt: new Date(Date.now() + ttlMs),
      totpPending: Boolean(user.totpEnabledAt),
      ip,
      userAgent,
    },
  });
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(ttlMs / 1000),
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

type SessionWithUser = { id: string; totpPending: boolean; user: User };

/** Current session for this request (memoised). Returns null when signed out or expired. */
export const getSession = cache(async (): Promise<SessionWithUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { id: sha256(token) }, include: { user: true } });
  if (!session) return null;
  if (session.expiresAt < new Date() || !session.user.isActive || session.user.deletedAt) {
    await db.session.deleteMany({ where: { id: session.id } });
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 15 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return { id: session.id, totpPending: session.totpPending, user: session.user };
});

/** The signed-in user (fully authenticated), or null. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session || session.totpPending) return null;
  return session.user;
}

export async function requireUser(returnTo = "/account"): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  return user;
}

export class ForbiddenError extends Error {
  constructor() {
    super("You do not have permission to do that.");
    this.name = "ForbiddenError";
  }
}

/** Use in admin pages: redirects to login, or shows "forbidden" when the role lacks the permission. */
export async function requireStaffPage(permission: Permission = "dashboard.view"): Promise<User> {
  const session = await getSession();
  if (!session) redirect(`/login?next=/admin`);
  if (session.totpPending) redirect(`/login/two-factor?next=/admin`);
  const user = session.user;
  if (!isStaffRole(user.role)) redirect("/");
  if (!hasPermission(user.role, permission)) redirect("/admin?forbidden=1");
  return user;
}

/** Use in admin server actions and route handlers: throws instead of redirecting. */
export async function requireStaff(permission: Permission): Promise<User> {
  const user = await getCurrentUser();
  if (!user || !isStaffRole(user.role) || !hasPermission(user.role, permission)) throw new ForbiddenError();
  return user;
}

export async function can(permission: Permission): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user && hasPermission(user.role, permission));
}
