import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { waLink } from "@/lib/whatsapp";
import { updateSupportAction } from "@/app/admin/_actions/customers";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, fmtDateTime } from "@/components/admin/ui";
import { Alert, Field, Select, Textarea, buttonClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/store/icons";
import { SUPPORT_TYPE_LABEL } from "@/lib/support";

export const metadata: Metadata = { title: "Support request" };

export default async function SupportRequestPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaffPage("support.manage");
  const r = await db.supportRequest.findUnique({ where: { id: (await params).id }, include: { order: true, user: true } });
  if (!r) notFound();
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/admin/support", label: "Support requests" }} title={r.subject} description={`${SUPPORT_TYPE_LABEL[r.type]} · ${fmtDateTime(r.createdAt)}`} />
      {r.type === "PRIVACY_DELETION" && r.user && <Alert tone="warning" className="mb-4">This is a data deletion request. Open the <Link href={`/admin/customers/${r.user.id}`} className="underline">customer profile</Link> to delete their personal data, then mark this request resolved.</Alert>}
      <Panel className="mb-6">
        <p className="mb-4 whitespace-pre-wrap text-sm">{r.message}</p>
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4 text-sm text-muted">
          <span className="font-semibold text-white">{r.name}</span>
          {r.email && <a href={`mailto:${r.email}?subject=${encodeURIComponent(`Re: ${r.subject}`)}`} className="text-brand-300">{r.email}</a>}
          {r.phone && <a href={waLink(r.phone, `Hello ${r.name}, this is Digital District about your message “${r.subject}”.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "sm")}><WhatsAppIcon className="size-4" /> {formatPhone(r.phone)}</a>}
          {r.order && <Link href={`/admin/orders/${r.order.id}`} className="text-brand-300">Order {r.order.number}</Link>}
        </div>
      </Panel>
      <Panel title="Handle request">
        <ActionForm action={updateSupportAction} submitLabel="Save">
          <input type="hidden" name="id" value={r.id} />
          <Field label="Status" htmlFor="st"><Select id="st" name="status" defaultValue={r.status}><option value="OPEN">Open</option><option value="IN_PROGRESS">In progress</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></Select></Field>
          <Field label="Reply / resolution (shown to the customer in their account)" htmlFor="res"><Textarea id="res" name="resolution" defaultValue={r.resolution ?? ""} /></Field>
        </ActionForm>
      </Panel>
    </div>
  );
}
