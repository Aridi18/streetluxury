import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { expireUnconfirmedOrders, sendRenewalReminders } from "@/lib/jobs";
import { deliverManually } from "@/lib/fulfillment";
import { recordPayment } from "@/lib/payments";
import { makeProduct, makeStaff, makeZone, makePaymentMethod, quickOrder, resetDb } from "../helpers";

beforeEach(resetDb);

describe("scheduled jobs", () => {
  it("auto-cancels stale unconfirmed orders and returns their stock, but never paid ones", async () => {
    const pm = await makePaymentMethod("CASH_ON_DELIVERY");
    const zone = await makeZone(0);
    const product = await makeProduct({ variants: [{ price: 1000, stock: 5 }] });
    const stale = await quickOrder([{ variantId: product.variants[0].id, quantity: 2 }], { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "B", address: "A" });
    const paid = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "B", address: "A", phone: "96171999999" });
    const owner = await makeStaff();
    await recordPayment(owner, paid.id, { amount: 500, methodId: null, reference: null, note: null });
    await db.order.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireUnconfirmedOrders()).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: stale.id } })).status).toBe("CANCELLED");
    expect((await db.order.findUniqueOrThrow({ where: { id: paid.id } })).status).not.toBe("CANCELLED");
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(4);
  });

  it("sends one renewal reminder before a subscription ends", async () => {
    const owner = await makeStaff();
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 400, durationDays: 30 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { source: "WHATSAPP" });
    await recordPayment(owner, placed.id, { amount: 400, methodId: null, reference: null, note: null });
    const d = await db.digitalDelivery.findFirstOrThrow({ where: { orderId: placed.id } });
    await deliverManually(owner, d.id, { content: "details", startsAt: null, expiresAt: new Date(Date.now() + 2 * 86400_000), internalNote: null });
    expect(await sendRenewalReminders()).toBe(1);
    expect(await sendRenewalReminders()).toBe(0);
    expect(await db.notification.count({ where: { type: "renewal_due" } })).toBe(1);
  });
});
