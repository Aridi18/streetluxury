import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Bell, ExternalLink } from "lucide-react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { isStaffRole, permissionsFor, ROLE_LABELS } from "@/lib/permissions";
import { AdminNav } from "@/components/admin/admin-nav";
import { Logo } from "@/components/store/logo";
import { signOutAction } from "@/app/actions/account";

export const metadata: Metadata = { title: { default: "Admin", template: "%s · Admin" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/admin");
  if (session.totpPending) redirect("/login/two-factor?next=/admin");
  const user = session.user;
  if (!isStaffRole(user.role)) redirect("/");
  const [settings, perms] = [await getSettings(), [...permissionsFor(user.role)]];
  const unread = await db.notification.count({ where: { readAt: null, permission: { in: perms } } });
  const needs2fa = settings.require2faForStaff && !user.totpEnabledAt;
  const path = (await headers()).get("x-pathname") ?? "";
  if (needs2fa && !path.startsWith("/admin/security")) redirect("/admin/security?required=1");
  return (
    <div className="min-h-dvh bg-canvas">
      <header className="print:hidden fixed inset-x-0 top-0 z-40 flex h-16 items-center gap-3 border-b border-line bg-ink px-4">
        <AdminNav permissions={perms} />
        <Logo logoKey={settings.logoKey} storeName={settings.storeName} size="sm" />
        <span className="hidden rounded-full border border-brand-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-brand-200 sm:inline">Admin</span>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/" target="_blank" className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-white sm:flex">View store <ExternalLink className="size-3.5" /></Link>
          <Link href="/admin/notifications" className="relative grid size-10 place-items-center rounded-lg hover:bg-surface-2" aria-label={`Notifications, ${unread} unread`}>
            <Bell className="size-5" />
            {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-brand-500 px-1 text-[10px] font-bold">{unread > 99 ? "99+" : unread}</span>}
          </Link>
          <div className="hidden text-right text-xs leading-tight md:block">
            <p className="font-semibold text-white">{user.name}</p>
            <p className="text-subtle">{ROLE_LABELS[user.role]}</p>
          </div>
          <form action={signOutAction}><button className="ml-2 rounded-lg px-3 py-2 text-sm text-muted hover:bg-surface-2 hover:text-white">Sign out</button></form>
        </div>
      </header>
      <main className="px-4 pb-16 pt-24 lg:pl-[17rem] lg:pr-8 print:p-0">
        {needs2fa && (
          <div className="mb-6 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            Two-step verification is required for staff. <Link href="/admin/security" className="font-semibold underline">Set it up now</Link>.
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
