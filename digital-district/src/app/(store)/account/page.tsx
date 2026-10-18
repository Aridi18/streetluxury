import Link from "next/link";
import { Clock } from "lucide-react";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { emailConfigured } from "@/lib/email";
import { resendVerificationAction } from "@/app/actions/account";
import { OrderRow } from "@/components/store/order-row";
import { Alert, Button, EmptyState, LinkButton } from "@/components/ui";

const daysFromNow = (days: number) => new Date(Date.now() + days * 86400_000);

export default async function AccountOverview() {
  const user = await requireUser();
  const [orders, counts, expiring] = await Promise.all([
    db.order.findMany({ where: { userId: user.id }, orderBy: { placedAt: "desc" }, take: 5, include: { _count: { select: { items: true } } } }),
    db.order.groupBy({ by: ["status"], where: { userId: user.id }, _count: true }),
    db.digitalDelivery.findMany({
      where: { order: { userId: user.id }, status: "DELIVERED", expiresAt: { gt: daysFromNow(0), lt: daysFromNow(30) } },
      include: { orderItem: true, order: true },
      orderBy: { expiresAt: "asc" },
    }),
  ]);
  const total = counts.reduce((s, c) => s + c._count, 0);
  return (
    <div className="space-y-8">
      {!user.emailVerifiedAt && emailConfigured() && (
        <Alert tone="info" title="Please confirm your email">
          <form action={resendVerificationAction} className="mt-2 flex items-center gap-3">
            <span>We sent a confirmation link to {user.email}.</span>
            <Button size="sm" variant="secondary">Resend</Button>
          </form>
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Orders" value={String(total)} />
        <Stat label="Active subscriptions ending soon" value={String(expiring.length)} />
        <Stat label="Saved to wishlist" value={String(await db.wishlistItem.count({ where: { userId: user.id } }))} />
      </div>
      {expiring.length > 0 && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Renewals coming up</h2>
          <ul className="space-y-2 text-sm">
            {expiring.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{d.orderItem.productTitle}{d.orderItem.variantName !== "Default" ? ` — ${d.orderItem.variantName}` : ""}</span>
                <span className="flex items-center gap-1.5 text-warning"><Clock className="size-4" /> Ends {d.expiresAt!.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Recent orders</h2>
          {total > 0 && <Link href="/account/orders" className="text-sm text-brand-300">View all</Link>}
        </div>
        {orders.length ? (
          <div className="space-y-2">{orders.map((o) => <OrderRow key={o.id} order={o} itemCount={o._count.items} />)}</div>
        ) : (
          <EmptyState title="No orders yet" action={<LinkButton href="/shop">Start shopping</LinkButton>} />
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-subtle">{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
    </div>
  );
}
