import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { formatPhone, normalizePhone } from "@/lib/phone";
import { formatMoney } from "@/lib/money";
import { PageHeader, Pagination, Table, fmtDate } from "@/components/admin/ui";
import { Badge, Button, Input, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Customers" };
const PAGE = 40;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tag?: string; page?: string }> }) {
  const user = await requireStaffPage("customers.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const phone = sp.q ? normalizePhone(sp.q) : null;
  const where: Prisma.UserWhereInput = {
    role: "CUSTOMER",
    deletedAt: null,
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { email: { contains: sp.q, mode: "insensitive" } }, ...(phone ? [{ phone }] : [])] } : {}),
    ...(sp.tag ? { customerTags: { has: sp.tag } } : {}),
  };
  const [customers, total] = await Promise.all([
    db.user.findMany({ where, orderBy: { createdAt: "desc" }, take: PAGE, skip: (page - 1) * PAGE, include: { _count: { select: { orders: true } } } }),
    db.user.count({ where }),
  ]);
  const spend = await db.order.groupBy({ by: ["userId"], where: { userId: { in: customers.map((c) => c.id) }, paidAt: { not: null } }, _sum: { paidTotal: true, refundedTotal: true } });
  const spendOf = new Map(spend.map((x) => [x.userId, (x._sum.paidTotal ?? 0) - (x._sum.refundedTotal ?? 0)]));
  return (
    <div>
      <PageHeader title="Customers" description={`${total} registered customer${total === 1 ? "" : "s"}. Guest buyers appear on their orders.`} actions={hasPermission(user.role, "customers.export") && <a href="/api/admin/export/customers" className={buttonClass("secondary", "sm")}><Download className="size-4" /> Export CSV</a>} />
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Name, email or phone…" className="h-10 max-w-sm" />
        <Input name="tag" defaultValue={sp.tag} placeholder="Segment" className="h-10 w-40" />
        <Button size="sm" className="h-10">Search</Button>
      </form>
      <Table>
        <thead><tr><th>Customer</th><th>Phone</th><th>Segments</th><th className="text-right">Orders</th><th className="text-right">Net spend</th><th>Joined</th></tr></thead>
        <tbody>
          {customers.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/admin/customers/${c.id}`} className="font-semibold text-white hover:text-brand-200">{c.name}</Link><p className="text-xs text-subtle">{c.email}</p></td>
              <td className="text-muted">{formatPhone(c.phone) || "—"}</td>
              <td>{c.customerTags.map((t) => <Badge key={t} className="mr-1">{t}</Badge>)}</td>
              <td className="text-right">{c._count.orders}</td>
              <td className="text-right">{formatMoney(spendOf.get(c.id) ?? 0)}</td>
              <td className="text-muted">{fmtDate(c.createdAt)}</td>
            </tr>
          ))}
          {!customers.length && <tr><td colSpan={6} className="py-8 text-center text-subtle">No customers found.</td></tr>}
        </tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE} href={(p) => `/admin/customers?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), ...(sp.tag ? { tag: sp.tag } : {}), page: String(p) })}`} />
    </div>
  );
}
