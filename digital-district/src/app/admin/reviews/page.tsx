import type { Metadata } from "next";
import Link from "next/link";
import type { ReviewStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { moderateReviewAction } from "@/app/admin/_actions/customers";
import { PageHeader, Empty, fmtDateTime } from "@/components/admin/ui";
import { Badge, Button, cn } from "@/components/ui";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ status?: ReviewStatus }> }) {
  await requireStaffPage("reviews.moderate");
  const status = (await searchParams).status ?? "PENDING";
  const reviews = await db.review.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 100, include: { product: { select: { title: true, slug: true } }, orderItem: { select: { order: { select: { id: true, number: true } } } } } });
  return (
    <div className="max-w-4xl">
      <PageHeader title="Reviews" description="Only customers with a delivered order can review. Approve genuine reviews; reject spam or abuse — never edit what a customer wrote." />
      <div className="mb-4 flex gap-2">
        {(["PENDING", "APPROVED", "REJECTED"] as const).map((s) => <Link key={s} href={`/admin/reviews?status=${s}`} className={cn("rounded-lg px-3 py-1.5 text-sm", s === status ? "bg-brand-500 text-white" : "text-muted hover:text-white")}>{s.toLowerCase()}</Link>)}
      </div>
      {!reviews.length && <Empty>No {status.toLowerCase()} reviews.</Empty>}
      <ul className="space-y-3">
        {reviews.map((r) => (
          <li key={r.id} className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-white">{"★".repeat(r.rating)}<span className="text-line-strong">{"★".repeat(5 - r.rating)}</span> · <Link href={`/product/${r.product.slug}`} className="hover:text-brand-200">{r.product.title}</Link></p>
              <Badge tone={r.status === "APPROVED" ? "success" : r.status === "REJECTED" ? "danger" : "warning"}>{r.status.toLowerCase()}</Badge>
            </div>
            {r.title && <p className="mt-2 font-semibold">{r.title}</p>}
            <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{r.body}</p>
            <p className="mt-2 text-xs text-subtle">{r.authorName} · {fmtDateTime(r.createdAt)} · verified via <Link href={`/admin/orders/${r.orderItem.order.id}`} className="text-brand-300">{r.orderItem.order.number}</Link></p>
            <div className="mt-3 flex gap-2">
              {r.status !== "APPROVED" && <form action={moderateReviewAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="APPROVED" /><Button size="sm">Approve</Button></form>}
              {r.status !== "REJECTED" && <form action={moderateReviewAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="REJECTED" /><Button size="sm" variant="danger">Reject</Button></form>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
