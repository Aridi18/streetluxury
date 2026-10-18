import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { PageHeader, Pagination, Table, fmtDateTime } from "@/components/admin/ui";
import { Button, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Audit log" };
const PAGE = 100;

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requireStaffPage("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ action: { contains: sp.q, mode: "insensitive" as const } }, { summary: { contains: sp.q, mode: "insensitive" as const } }, { actorName: { contains: sp.q, mode: "insensitive" as const } }, { entityId: sp.q }] } : {};
  const [logs, total] = await Promise.all([db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE }), db.auditLog.count({ where })]);
  return (
    <div>
      <PageHeader title="Audit log" description="A permanent record of significant admin actions: who did what, and when." />
      <form method="get" className="mb-4 flex gap-2"><Input name="q" defaultValue={sp.q} placeholder="Search action, person or text…" className="h-10 max-w-sm" /><Button size="sm" className="h-10">Search</Button></form>
      <Table>
        <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
        <tbody>{logs.map((l) => <tr key={l.id}><td className="whitespace-nowrap text-xs text-subtle">{fmtDateTime(l.createdAt)}</td><td>{l.actorName}</td><td className="font-mono text-xs text-brand-200">{l.action}</td><td className="text-muted">{l.summary}</td></tr>)}</tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE} href={(p) => `/admin/audit?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), page: String(p) })}`} />
    </div>
  );
}
