import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncCardPayment } from "@/lib/payments";
import { orderAccessKey, verifyOrderAccessKey } from "@/lib/order-core";
import { env } from "@/lib/env";

/** The bank redirects the customer here. We never trust the redirect itself: we ask the gateway for the real status. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const number = url.searchParams.get("order") ?? "";
  const order = await db.order.findUnique({ where: { number }, include: { payments: { where: { provider: "mpgs" }, orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!order || !verifyOrderAccessKey(order.id, url.searchParams.get("key"))) return NextResponse.redirect(`${env.appUrl}/`);
  const payment = order.payments[0];
  if (payment?.providerOrderId) await syncCardPayment(payment.providerOrderId, "return").catch((err) => console.error("Card payment sync failed", err));
  return NextResponse.redirect(`${env.appUrl}/order/${order.number}?key=${orderAccessKey(order.id)}`);
}
