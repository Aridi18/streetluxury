import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { syncCardPayment } from "@/lib/payments";

/**
 * Gateway notification. Authenticated with the shared notification secret, then used only as a trigger:
 * the payment status is re-read from the gateway API before anything is recorded.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-notification-secret") ?? "";
  if (!env.mpgs.webhookSecret || !safeEqual(secret, env.mpgs.webhookSecret)) return new NextResponse("Unauthorized", { status: 401 });
  const body = (await request.json().catch(() => null)) as { order?: { id?: string } } | null;
  const providerOrderId = body?.order?.id;
  await db.paymentEvent.create({ data: { provider: "mpgs", type: "webhook", payload: JSON.parse(JSON.stringify(body ?? {})) } });
  if (providerOrderId) await syncCardPayment(providerOrderId, "webhook");
  return NextResponse.json({ ok: true });
}
