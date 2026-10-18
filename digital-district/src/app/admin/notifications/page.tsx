import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { permissionsFor } from "@/lib/permissions";
import { markNotificationsReadAction } from "@/app/admin/_actions/setup";
import { PageHeader, Empty, fmtDateTime } from "@/components/admin/ui";
import { Button, cn } from "@/components/ui";

export const metadata: Metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const user = await requireStaffPage("dashboard.view");
  const items = await db.notification.findMany({ where: { permission: { in: [...permissionsFor(user.role)] } }, orderBy: { createdAt: "desc" }, take: 100 });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Notifications" actions={items.some((n) => !n.readAt) && <form action={markNotificationsReadAction}><Button size="sm" variant="secondary">Mark all as read</Button></form>} />
      {!items.length && <Empty>No notifications yet. New orders, payments to verify, low stock and failed deliveries appear here.</Empty>}
      <ul className="space-y-2">
        {items.map((n) => (
          <li key={n.id}>
            <Link href={n.link ?? "#"} className={cn("block rounded-xl border p-4 transition hover:border-brand-500/40", n.readAt ? "border-line bg-surface" : "border-brand-500/30 bg-brand-500/10")}>
              <p className="font-semibold text-white">{n.title}</p>
              {n.body && <p className="text-sm text-muted">{n.body}</p>}
              <p className="mt-1 text-xs text-subtle">{fmtDateTime(n.createdAt)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
