import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { PERMISSIONS, ROLE_LABELS, STAFF_ROLES, hasPermission } from "@/lib/permissions";
import { inviteStaffAction, revokeInvitationAction, updateStaffAction } from "@/app/admin/_actions/setup";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, Table, fmtDateTime } from "@/components/admin/ui";
import { Badge, Button, Checkbox, Field, Input, Select } from "@/components/ui";

export const metadata: Metadata = { title: "Staff & roles" };

export default async function StaffPage() {
  const me = await requireStaffPage("staff.manage");
  const [staff, invites] = await Promise.all([
    db.user.findMany({ where: { role: { not: "CUSTOMER" }, deletedAt: null }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    db.staffInvitation.findMany({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Staff & roles" description="Each person gets their own login. Roles decide what they can see and change — enforced on the server for every page and action." />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {staff.map((u) => (
            <Panel key={u.id} title={<span>{u.name} <span className="text-sm font-normal text-subtle">{u.email}</span></span>} actions={<span className="flex gap-2">{u.totpEnabledAt ? <Badge tone="success">2-step on</Badge> : <Badge tone="warning">2-step off</Badge>}{!u.isActive && <Badge tone="danger">Deactivated</Badge>}</span>}>
              <ActionForm action={updateStaffAction} submitLabel="Update" submitVariant="secondary" className="flex flex-wrap items-end gap-3 space-y-0">
                <input type="hidden" name="id" value={u.id} />
                <Select name="role" defaultValue={u.role} className="w-60" aria-label="Role" disabled={u.id === me.id}>{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}<option value="CUSTOMER">Remove admin access</option></Select>
                {u.id === me.id && <input type="hidden" name="role" value={u.role} />}
                <Checkbox name="isActive" defaultChecked={u.isActive} label="Active" disabled={u.id === me.id} />
                {u.id === me.id && <input type="hidden" name="isActive" value="on" />}
              </ActionForm>
              <p className="mt-2 text-xs text-subtle">Last sign-in: {fmtDateTime(u.lastLoginAt)}</p>
            </Panel>
          ))}
        </div>
        <div className="space-y-6">
          <Panel title="Invite a team member">
            <ActionForm action={inviteStaffAction} submitLabel="Create invitation" resetOnSuccess>
              <Field label="Email" htmlFor="inv-email" required><Input id="inv-email" name="email" type="email" required /></Field>
              <Field label="Name" htmlFor="inv-name"><Input id="inv-name" name="name" /></Field>
              <Field label="Role" htmlFor="inv-role"><Select id="inv-role" name="role" defaultValue="ORDER_MANAGER">{STAFF_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select></Field>
            </ActionForm>
            {invites.length > 0 && (
              <ul className="mt-4 space-y-2 text-sm">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2"><span>{i.email} <span className="text-xs text-subtle">· {ROLE_LABELS[i.role]}</span></span><form action={revokeInvitationAction}><input type="hidden" name="id" value={i.id} /><Button size="sm" variant="ghost">Revoke</Button></form></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <h2 className="font-semibold">What each role can do</h2>
      <Table>
        <thead><tr><th>Permission</th>{STAFF_ROLES.map((r) => <th key={r} className="text-center">{ROLE_LABELS[r].split(" /")[0]}</th>)}</tr></thead>
        <tbody>{PERMISSIONS.map((p) => <tr key={p}><td className="font-mono text-xs">{p}</td>{STAFF_ROLES.map((r) => <td key={r} className="text-center">{hasPermission(r, p) ? <span className="text-success">✓</span> : <span className="text-line-strong">—</span>}</td>)}</tr>)}</tbody>
      </Table>
    </div>
  );
}
