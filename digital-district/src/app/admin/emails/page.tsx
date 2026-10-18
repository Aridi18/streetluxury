import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { PageHeader, Table, fmtDateTime } from "@/components/admin/ui";
import { Alert, Badge } from "@/components/ui";

export const metadata: Metadata = { title: "Email log" };

export default async function EmailsPage() {
  await requireStaffPage("settings.manage");
  const logs = await db.emailLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <div className="max-w-5xl">
      <PageHeader title="Email log" description="Every email the store tried to send." />
      {!emailConfigured() && <Alert tone="warning" className="mb-4">Email is not configured (SMTP_URL), so messages are recorded here as “not sent”. Customers can still see everything on their order pages.</Alert>}
      <Table>
        <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
        <tbody>{logs.map((l) => <tr key={l.id}><td className="whitespace-nowrap text-xs text-subtle">{fmtDateTime(l.createdAt)}</td><td>{l.to}</td><td>{l.subject}{l.error && <p className="text-xs text-danger">{l.error}</p>}</td><td><Badge tone={l.status === "SENT" ? "success" : l.status === "FAILED" ? "danger" : "warning"}>{l.status === "NOT_CONFIGURED" ? "not sent" : l.status.toLowerCase()}</Badge></td></tr>)}</tbody>
      </Table>
    </div>
  );
}
