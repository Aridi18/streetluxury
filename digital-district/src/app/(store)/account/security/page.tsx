import type { Metadata } from "next";
import { db } from "@/lib/db";
import { getSession, requireUser } from "@/lib/auth";
import { changePasswordAction, signOutOthersAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  const user = await requireUser("/account/security");
  const current = await getSession();
  const sessions = await db.session.findMany({ where: { userId: user.id, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  return (
    <div className="space-y-6">
      <section className="card max-w-xl p-6">
        <h2 className="mb-4 text-xl font-semibold">Change password</h2>
        <ActionForm action={changePasswordAction} submitLabel="Change password" resetOnSuccess>
          <Field label="Current password" htmlFor="current"><Input id="current" name="current" type="password" required autoComplete="current-password" /></Field>
          <Field label="New password" htmlFor="password" hint="At least 10 characters, with letters and numbers"><Input id="password" name="password" type="password" required minLength={10} autoComplete="new-password" /></Field>
          <Field label="Confirm new password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" required autoComplete="new-password" /></Field>
        </ActionForm>
      </section>
      <section className="card p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Signed-in devices</h2>
          {sessions.length > 1 && <form action={signOutOthersAction}><Button size="sm" variant="outline">Sign out other devices</Button></form>}
        </div>
        <ul className="divide-y divide-line text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <span className="min-w-0 truncate text-muted">{s.userAgent ?? "Unknown device"}</span>
              <span className="flex items-center gap-2 text-xs text-subtle">
                {s.id === current?.id && <Badge tone="success">This device</Badge>}
                Last active {s.lastSeenAt.toLocaleString("en-GB", { timeZone: "Asia/Beirut" })}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
