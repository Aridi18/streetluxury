import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatPhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { waLink } from "@/lib/whatsapp";
import { ORDER_STATUS_LABELS, ORDER_STATUS_TONE } from "@/lib/order-status";
import { addCustomerNoteAction, anonymizeCustomerAction, resetLinkAction, setCustomerTagsAction } from "@/app/admin/_actions/customers";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, Stat, Table, fmtDate, fmtDateTime } from "@/components/admin/ui";
import { Badge, Input, Textarea, buttonClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/store/icons";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaffPage("customers.view");
  const { id } = await params;
  const c = await db.user.findFirst({
    where: { id, role: "CUSTOMER" },
    include: { orders: { orderBy: { placedAt: "desc" } }, addresses: true, customerNotes: { orderBy: { createdAt: "desc" }, include: { author: { select: { name: true } } } }, supportRequests: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  if (!c) notFound();
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(staff.role, p);
  const paid = c.orders.filter((o) => o.paidAt).reduce((s, o) => s + o.paidTotal - o.refundedTotal, 0);
  return (
    <div>
      <PageHeader back={{ href: "/admin/customers", label: "Customers" }} title={c.name} description={<>{c.email}{c.phone && ` · ${formatPhone(c.phone)}`}{c.deletedAt && " · deleted"}</>} actions={c.phone && <a href={waLink(c.phone, `Hello ${c.name}, this is Digital District.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "sm")}><WhatsAppIcon className="size-4" /> WhatsApp</a>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Orders" value={c.orders.length} />
        <Stat label="Net spend" value={formatMoney(paid)} />
        <Stat label="Customer since" value={fmtDate(c.createdAt)} />
        <Stat label="Email" value={c.emailVerifiedAt ? "Verified" : "Not verified"} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Table>
            <thead><tr><th>Order</th><th>Status</th><th className="text-right">Total</th></tr></thead>
            <tbody>
              {c.orders.map((o) => (
                <tr key={o.id}><td><Link href={`/admin/orders/${o.id}`} className="font-mono font-semibold text-white">{o.number}</Link><p className="text-xs text-subtle">{fmtDateTime(o.placedAt)}</p></td><td><Badge tone={ORDER_STATUS_TONE[o.status]}>{ORDER_STATUS_LABELS[o.status]}</Badge></td><td className="text-right">{formatMoney(o.total)}</td></tr>
              ))}
              {!c.orders.length && <tr><td colSpan={3} className="text-center text-subtle">No orders yet.</td></tr>}
            </tbody>
          </Table>
          {c.addresses.length > 0 && (
            <Panel title="Addresses">
              <ul className="space-y-2 text-sm text-muted">{c.addresses.map((a) => <li key={a.id}>{a.fullName} · {formatPhone(a.phone)} · {[a.addressLine, a.area, a.city].filter(Boolean).join(", ")}</li>)}</ul>
            </Panel>
          )}
          {c.supportRequests.length > 0 && (
            <Panel title="Support requests">
              <ul className="space-y-2 text-sm">{c.supportRequests.map((r) => <li key={r.id}><Link href={`/admin/support/${r.id}`} className="text-brand-200">{r.subject}</Link> <span className="text-xs text-subtle">· {r.status.toLowerCase()} · {fmtDate(r.createdAt)}</span></li>)}</ul>
            </Panel>
          )}
        </div>
        <div className="space-y-6">
          {can("customers.manage") && (
            <Panel title="Private support notes">
              <p className="mb-3 text-xs text-subtle">Visible to staff with customer access only. Don&apos;t store payment card details here.</p>
              <ActionForm action={addCustomerNoteAction} submitLabel="Add note" submitVariant="secondary" resetOnSuccess>
                <input type="hidden" name="customerId" value={c.id} />
                <Textarea name="body" required className="min-h-16" aria-label="Note" />
              </ActionForm>
              <ul className="mt-3 space-y-2 text-sm">{c.customerNotes.map((n) => <li key={n.id} className="rounded-lg bg-surface-2 p-3"><p className="whitespace-pre-wrap">{n.body}</p><p className="mt-1 text-xs text-subtle">{n.author?.name ?? "—"} · {fmtDateTime(n.createdAt)}</p></li>)}</ul>
            </Panel>
          )}
          {can("customers.manage") && (
            <Panel title="Segments">
              <ActionForm action={setCustomerTagsAction} submitLabel="Save segments" submitVariant="secondary">
                <input type="hidden" name="customerId" value={c.id} />
                <Input name="tags" defaultValue={c.customerTags.join(", ")} placeholder="e.g. vip, reseller, gamer" aria-label="Segments" />
              </ActionForm>
              <p className="mt-2 text-xs text-subtle">Marketing emails consent: {c.marketingOptIn ? "yes" : "no"}</p>
            </Panel>
          )}
          {can("customers.manage") && !c.deletedAt && (
            <Panel title="Account access">
              <ActionForm action={resetLinkAction} submitLabel="Create password reset link" submitVariant="secondary">
                <input type="hidden" name="customerId" value={c.id} />
                <p className="text-xs text-subtle">Emails the link if email is set up, and shows it here so you can send it on WhatsApp.</p>
              </ActionForm>
            </Panel>
          )}
          {can("customers.export") && !c.deletedAt && (
            <Panel title="Delete personal data">
              <ActionForm action={anonymizeCustomerAction} submitLabel="Delete customer data" submitVariant="danger">
                <input type="hidden" name="customerId" value={c.id} />
                <p className="text-xs text-muted">For privacy requests. Removes the account and personal details; anonymous order totals stay in your reports. This cannot be undone.</p>
                <Input name="confirm" placeholder="Type DELETE to confirm" aria-label="Confirm" />
              </ActionForm>
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}
