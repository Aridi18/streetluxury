import type { Metadata } from "next";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { PageHeader, Stat, Table, fmtDateTime } from "@/components/admin/ui";
import { buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Newsletter" };

export default async function NewsletterPage() {
  await requireStaffPage("customers.export");
  const [subs, unsubscribed] = await Promise.all([db.newsletterSubscriber.findMany({ where: { unsubscribedAt: null }, orderBy: { createdAt: "desc" }, take: 500 }), db.newsletterSubscriber.count({ where: { unsubscribedAt: { not: null } } })]);
  return (
    <div className="max-w-4xl">
      <PageHeader title="Newsletter subscribers" description="Everyone here ticked the consent box. Only email people on this list, and include an unsubscribe link in every email." actions={<a href="/api/admin/export/newsletter" className={buttonClass("secondary", "sm")}><Download className="size-4" /> Export CSV</a>} />
      <div className="mb-6 grid grid-cols-2 gap-3"><Stat label="Subscribed" value={subs.length} /><Stat label="Unsubscribed" value={unsubscribed} /></div>
      <Table>
        <thead><tr><th>Email</th><th>Consent given</th><th>Unsubscribe link</th></tr></thead>
        <tbody>
          {subs.map((s) => <tr key={s.id}><td>{s.email}</td><td className="text-muted">{fmtDateTime(s.consentAt)}</td><td className="font-mono text-xs text-subtle">/newsletter/unsubscribe/{s.unsubscribeToken}</td></tr>)}
          {!subs.length && <tr><td colSpan={3} className="py-8 text-center text-subtle">No subscribers yet.</td></tr>}
        </tbody>
      </Table>
    </div>
  );
}
