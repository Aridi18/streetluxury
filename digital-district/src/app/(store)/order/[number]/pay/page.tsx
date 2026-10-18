import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { loadOrderForViewer } from "@/lib/order-access";
import { orderAccessKey } from "@/lib/order-core";
import { balanceDue, startCardPayment } from "@/lib/payments";
import { formatMoney } from "@/lib/money";
import { env } from "@/lib/env";
import { UserError } from "@/lib/errors";
import { CardCheckout } from "@/components/store/card-checkout";
import { Alert } from "@/components/ui";

export const metadata: Metadata = { title: "Pay by card", robots: { index: false } };

export default async function PayPage({ params, searchParams }: { params: Promise<{ number: string }>; searchParams: Promise<{ key?: string }> }) {
  const { number } = await params;
  const { key } = await searchParams;
  const access = await loadOrderForViewer(number, key);
  if (!access) notFound();
  const { order } = access;
  const accessKey = orderAccessKey(order.id);
  if (balanceDue(order) <= 0 || order.status === "CANCELLED") redirect(`/order/${order.number}?key=${accessKey}`);
  let session: { sessionId: string; checkoutScript: string } | null = null;
  let error: string | null = null;
  try {
    session = await startCardPayment(order.id, `${env.appUrl}/api/payments/mpgs/return?order=${encodeURIComponent(order.number)}&key=${accessKey}`);
  } catch (err) {
    error = err instanceof UserError ? err.message : "Card payment is temporarily unavailable.";
  }
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <div className="container-page max-w-lg py-16">
      <div className="card space-y-5 p-8">
        <p className="eyebrow">Secure card payment</p>
        <h1 className="text-2xl font-bold">Order {order.number}</h1>
        <p className="text-sm text-muted">You will enter your card details on the bank&apos;s own secure page. Digital District never sees or stores your card number.</p>
        {error ? <Alert tone="danger">{error}</Alert> : session && <CardCheckout sessionId={session.sessionId} scriptUrl={session.checkoutScript} amountLabel={formatMoney(balanceDue(order), order.currency)} nonce={nonce} />}
        <Link href={`/order/${order.number}?key=${accessKey}`} className="block text-center text-sm text-brand-300">Back to your order</Link>
      </div>
    </div>
  );
}
