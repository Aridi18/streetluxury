import type { Metadata } from "next";
import Link from "next/link";
import type { SupportStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { PageHeader, Table, fmtDateTime } from "@/components/admin/ui";
import { Badge, cn } from "@/components/ui";
import { SUPPORT_TYPE_LABEL } from "@/lib/support";

export const metadata: Metadata = { title: "Support requests" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireStaffPage("support.manage");
  const status = (await searchParams).status ?? "open";
  const requests = await db.supportRequest.findMany({
    where: status === "open" ? { status: { in: ["OPEN", "IN_PROGRESS"] } } : status === "all" ? {} : { status: status as SupportStatus },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { order: { select: { number: true } } },
  });
  return (
    <div>
      <PageHeader title="Support requests" description="Messages from the contact form, customer support and return requests, and privacy requests." />
      <div className="mb-4 flex gap-2">{["open", "RESOLVED", "CLOSED", "all"].map((s) => <Link key={s} href={`/admin/support?status=${s}`} className={cn("rounded-lg px-3 py-1.5 text-sm", s === status ? "bg-brand-500 text-white" : "text-muted hover:text-white")}>{s.toLowerCase()}</Link>)}</div>
      <Table>
        <thead><tr><th>Request</th><th>Type</th><th>From</th><th>Status</th><th>Received</th></tr></thead>
        <tbody>
          {requests.map((r) => (
            <tr key={r.id}>
              <td><Link href={`/admin/support/${r.id}`} className="font-semibold text-white hover:text-brand-200">{r.subject}</Link>{r.order && <p className="text-xs text-subtle">{r.order.number}</p>}</td>
              <td className="text-muted">{SUPPORT_TYPE_LABEL[r.type]}</td>
              <td>{r.name}</td>
              <td><Badge tone={r.status === "OPEN" ? "warning" : r.status === "IN_PROGRESS" ? "info" : "success"}>{r.status.toLowerCase().replace("_", " ")}</Badge></td>
              <td className="text-muted">{fmtDateTime(r.createdAt)}</td>
            </tr>
          ))}
          {!requests.length && <tr><td colSpan={5} className="py-8 text-center text-subtle">Nothing here.</td></tr>}
        </tbody>
      </Table>
    </div>
  );
}
