import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { Badge, EmptyState } from "@/components/ui";

export const metadata: Metadata = { title: "Digital library" };

export default async function DownloadsPage() {
  const user = await requireUser("/account/downloads");
  const [deliveries, logs] = await Promise.all([
    db.digitalDelivery.findMany({ where: { order: { userId: user.id } }, include: { orderItem: true, order: true }, orderBy: { createdAt: "desc" } }),
    db.downloadLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 30, include: { delivery: { include: { orderItem: true } } } }),
  ]);
  if (!deliveries.length) return <EmptyState title="No digital purchases yet">Subscriptions, licence keys and downloads you buy will appear here.</EmptyState>;
  const label = { PENDING: "Pending", PROCESSING: "Being prepared", DELIVERED: "Delivered", FAILED: "Delayed", REVOKED: "Revoked" } as const;
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-1 text-xl font-semibold">Digital library</h2>
        <p className="mb-4 text-sm text-muted">Open an order to see access details, licence keys and download links.</p>
        <ul className="space-y-2">
          {deliveries.map((d) => (
            <li key={d.id}>
              <Link href={`/order/${d.order.number}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-4 hover:border-brand-500/40">
                <span>
                  <span className="block font-semibold text-white">{d.orderItem.productTitle}{d.orderItem.variantName !== "Default" ? ` — ${d.orderItem.variantName}` : ""}</span>
                  <span className="text-xs text-subtle">Order {d.order.number}{d.expiresAt ? ` · ${d.expiresAt > new Date() ? "Active until" : "Expired"} ${d.expiresAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</span>
                </span>
                <Badge tone={d.status === "DELIVERED" ? "success" : d.status === "FAILED" ? "danger" : d.status === "REVOKED" ? "neutral" : "warning"}>{label[d.status]}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      </section>
      {logs.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Download history</h2>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface text-sm">
            {logs.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 px-4 py-2.5">
                <span>{l.delivery.orderItem.productTitle}</span>
                <span className="text-subtle">{l.createdAt.toLocaleString("en-GB", { timeZone: "Asia/Beirut" })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
