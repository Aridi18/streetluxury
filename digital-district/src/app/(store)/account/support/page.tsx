import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { supportRequestAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Support & returns" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<{ order?: string }> }) {
  const user = await requireUser("/account/support");
  const { order } = await searchParams;
  const [orders, requests] = await Promise.all([
    db.order.findMany({ where: { userId: user.id }, orderBy: { placedAt: "desc" }, take: 30, select: { number: true } }),
    db.supportRequest.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, include: { order: { select: { number: true } } } }),
  ]);
  return (
    <div className="space-y-6">
      <section className="card p-6">
        <h2 className="mb-4 text-xl font-semibold">Ask for help or request a return</h2>
        <ActionForm action={supportRequestAction} submitLabel="Send request" resetOnSuccess>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="type">
              <Select id="type" name="type" defaultValue="SUPPORT"><option value="SUPPORT">Help with an order or product</option><option value="RETURN">Return or refund request</option></Select>
            </Field>
            <Field label="Order (optional)" htmlFor="orderNumber">
              <Select id="orderNumber" name="orderNumber" defaultValue={order ?? ""}><option value="">Not about a specific order</option>{orders.map((o) => <option key={o.number}>{o.number}</option>)}</Select>
            </Field>
          </div>
          <Field label="Subject" htmlFor="subject"><Input id="subject" name="subject" required maxLength={160} /></Field>
          <Field label="Message" htmlFor="message"><Textarea id="message" name="message" required minLength={10} maxLength={4000} /></Field>
        </ActionForm>
      </section>
      {requests.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold">Your requests</h2>
          <ul className="space-y-2">
            {requests.map((r) => (
              <li key={r.id} className="card p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-white">{r.subject}</span>
                  <Badge tone={r.status === "RESOLVED" || r.status === "CLOSED" ? "success" : "warning"}>{r.status.replace("_", " ").toLowerCase()}</Badge>
                </div>
                <p className="mt-1 text-xs text-subtle">{r.createdAt.toLocaleDateString("en-GB")} {r.order && `· ${r.order.number}`}</p>
                {r.resolution && <p className="mt-2 text-muted">Our reply: {r.resolution}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
