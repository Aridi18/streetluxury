import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { recordPayment, rejectPayment, submitManualPayment, verifyPayment } from "@/lib/payments";
import { addLicenseKeys, createShipment, deliverManually, readDeliveryContent, revealLicenseKeys, updateShipmentStatus } from "@/lib/fulfillment";
import { changeOrderStatus, createRefund } from "@/lib/orders";
import { financialSummary } from "@/lib/reports";
import { resolvePeriod } from "@/lib/time";
import { makePaymentMethod, makeProduct, makeStaff, makeZone, quickOrder, resetDb } from "../helpers";

beforeEach(resetDb);

describe("manual payments", () => {
  it("keeps a submitted transfer pending until staff verify it, recording who and when", async () => {
    const owner = await makeStaff("FINANCE");
    const pm = await makePaymentMethod("MANUAL", { feePercentBps: 100, feeFixed: 10 });
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 2000, cost: 1200 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id });
    const payment = await submitManualPayment(placed.id, { reference: "WISH-123", proof: null });
    let order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.paymentStatus).toBe("PENDING_VERIFICATION");
    expect(order.paidAt).toBeNull();
    // The unverified transfer is not revenue.
    const before = await financialSummary(resolvePeriod("today"));
    expect(before.netSales).toBe(0);
    expect(before.pendingVerificationAmount).toBe(2000);

    await verifyPayment(owner, payment.id, {});
    order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order).toMatchObject({ paymentStatus: "PAID", status: "CONFIRMED", paidTotal: 2000 });
    expect(order.paidAt).not.toBeNull();
    const verified = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(verified).toMatchObject({ status: "SUCCEEDED", verifiedById: owner.id, fee: 30 });
    expect(verified.verifiedAt).not.toBeNull();
    await expect(verifyPayment(owner, payment.id, {})).rejects.toThrow(/already been processed/);
    expect(await db.auditLog.count({ where: { action: "payment.verify" } })).toBe(1);
  });

  it("lets staff reject a reference and the customer resubmit", async () => {
    const owner = await makeStaff();
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "DIGITAL", variants: [{ price: 1000 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id });
    const p1 = await submitManualPayment(placed.id, { reference: "BAD", proof: null });
    await expect(submitManualPayment(placed.id, { reference: "AGAIN", proof: null })).rejects.toThrow(/already being verified/);
    await rejectPayment(owner, p1.id, "No transfer found");
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.id } })).paymentStatus).toBe("FAILED");
    await submitManualPayment(placed.id, { reference: "GOOD", proof: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.id } })).paymentStatus).toBe("PENDING_VERIFICATION");
  });
});

describe("digital delivery", () => {
  it("assigns licence keys automatically once paid and keeps them encrypted", async () => {
    const owner = await makeStaff();
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "LICENSE", deliveryMode: "AUTOMATIC", variants: [{ price: 1500, track: false }] });
    const variantId = product.variants[0].id;
    const added = await addLicenseKeys(owner, variantId, "AAAA-1111\nBBBB-2222\nAAAA-1111\n");
    expect(added).toEqual({ added: 2, duplicates: 1 });
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockOnHand).toBe(2);
    const stored = await db.licenseKey.findFirstOrThrow();
    expect(stored.codeEnc).not.toContain("AAAA");

    const placed = await quickOrder([{ variantId, quantity: 1 }], { paymentMethodId: pm.id });
    let delivery = await db.digitalDelivery.findFirstOrThrow({ where: { orderId: placed.id } });
    expect(delivery.status).toBe("PENDING"); // not delivered before payment
    await recordPayment(owner, placed.id, { amount: 1500, methodId: pm.id, reference: "cash", note: null });
    delivery = await db.digitalDelivery.findFirstOrThrow({ where: { orderId: placed.id } });
    expect(delivery.status).toBe("DELIVERED");
    const keys = await revealLicenseKeys(delivery.licenseKeyIds);
    expect(["AAAA-1111", "BBBB-2222"]).toContain(keys[0].code);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.status).toBe("COMPLETED");
    expect((await db.product.findUniqueOrThrow({ where: { id: product.id } })).salesCount).toBe(1);
  });

  it("supports manual delivery with encrypted details and subscription expiry", async () => {
    const owner = await makeStaff("FULFILLMENT");
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 350, durationDays: 30 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { source: "WHATSAPP" });
    await recordPayment(owner, placed.id, { amount: 350, methodId: null, reference: null, note: "Whish received" });
    const delivery = await db.digitalDelivery.findFirstOrThrow({ where: { orderId: placed.id } });
    expect(delivery.status).toBe("PENDING");
    await deliverManually(owner, delivery.id, { content: "Profile 3, PIN 4821", startsAt: null, expiresAt: null, internalNote: null });
    const done = await db.digitalDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(done.status).toBe("DELIVERED");
    expect(done.contentEnc).not.toContain("4821");
    expect(readDeliveryContent(done.contentEnc)).toBe("Profile 3, PIN 4821");
    const days = (done.expiresAt!.getTime() - done.startsAt!.getTime()) / 86400_000;
    expect(Math.round(days)).toBe(30);
    expect((await db.order.findUniqueOrThrow({ where: { id: placed.id } })).status).toBe("COMPLETED");
  });
});

describe("physical fulfilment, refunds and accounting", () => {
  it("handles partial shipment, delivery, partial refund with restock, and the P&L", async () => {
    const owner = await makeStaff();
    const pm = await makePaymentMethod("CASH_ON_DELIVERY", { appliesTo: "PHYSICAL_ONLY" });
    const zone = await makeZone(500);
    const headset = await makeProduct({ title: "Headset", variants: [{ price: 4000, cost: 2500, stock: 10 }] });
    const cable = await makeProduct({ title: "Cable", variants: [{ price: 1000, cost: 300, stock: 10 }] });
    const placed = await quickOrder(
      [{ variantId: headset.variants[0].id, quantity: 2 }, { variantId: cable.variants[0].id, quantity: 1 }],
      { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "Jounieh", address: "Main road" },
    );
    let order = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true } });
    expect(order.total).toBe(9500);
    await changeOrderStatus(owner, order.id, "CONFIRMED", null, false);
    const headsetItem = order.items.find((i) => i.productTitle === "Headset")!;
    const cableItem = order.items.find((i) => i.productTitle === "Cable")!;
    await createShipment(owner, order.id, { items: [{ orderItemId: headsetItem.id, quantity: 2 }], courier: "Aramex", trackingNumber: "TRK1", trackingUrl: null, shippingCost: 400, status: "SHIPPED", note: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PARTIALLY_FULFILLED");
    await expect(createShipment(owner, order.id, { items: [{ orderItemId: headsetItem.id, quantity: 1 }], courier: null, trackingNumber: null, trackingUrl: null, shippingCost: 0, status: "SHIPPED", note: null })).rejects.toThrow(/left to fulfil/);
    await createShipment(owner, order.id, { items: [{ orderItemId: cableItem.id, quantity: 1 }], courier: "Aramex", trackingNumber: "TRK2", trackingUrl: "https://track.example/TRK2", shippingCost: 0, status: "SHIPPED", note: null });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("SHIPPED");
    for (const s of await db.shipment.findMany({ where: { orderId: order.id } })) await updateShipmentStatus(owner, s.id, "DELIVERED");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");

    // Cash collected on delivery.
    await recordPayment(owner, order.id, { amount: 9500, methodId: pm.id, reference: null, note: "COD" });
    await expect(recordPayment(owner, order.id, { amount: 1, methodId: pm.id, reference: null, note: null })).rejects.toThrow(/balance due/);
    await changeOrderStatus(owner, order.id, "COMPLETED", null, false);

    // One headset returned and restocked.
    await createRefund(owner, order.id, { amount: 4000, reason: "Defective", method: "Cash", reference: null, items: [{ orderItemId: headsetItem.id, quantity: 1, restock: true }] });
    order = await db.order.findUniqueOrThrow({ where: { id: order.id }, include: { items: true } });
    expect(order.status).toBe("PARTIALLY_REFUNDED");
    expect(order.paymentStatus).toBe("PARTIALLY_REFUNDED");
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: headset.variants[0].id } })).stockOnHand).toBe(9);
    await expect(createRefund(owner, order.id, { amount: 6000, reason: "x", method: null, reference: null, items: [] })).rejects.toThrow(/at most/);

    const expenseCat = await db.expenseCategory.create({ data: { name: "Advertising", isOperating: true } });
    await db.expense.create({ data: { categoryId: expenseCat.id, amount: 1000, incurredAt: new Date(), description: "Instagram ads" } });
    const otherCat = await db.expenseCategory.create({ data: { name: "Bank interest", isOperating: false } });
    await db.expense.create({ data: { categoryId: otherCat.id, amount: 200, incurredAt: new Date(), description: "Interest" } });

    const s = await financialSummary(resolvePeriod("today"));
    expect(s.orders).toBe(1);
    expect(s.productGross).toBe(9000);
    expect(s.shippingCharged).toBe(500);
    expect(s.grossSales).toBe(9500);
    expect(s.refunds).toBe(4000);
    expect(s.netSales).toBe(5500);
    expect(s.cogs).toBe(2 * 2500 + 300 - 2500); // restocked headset reverses its cost
    expect(s.grossProfit).toBe(5500 - 2800);
    expect(s.operatingExpenses).toBe(1000 + 400); // ads + courier cost recorded with the shipment
    expect(s.operatingProfit).toBe(2700 - 1400);
    expect(s.otherExpenses).toBe(200);
    expect(s.netProfit).toBe(1300 - 200);
    expect(s.cashCollected).toBe(9500);
    expect(s.netCash).toBe(5500);
  });

  it("never counts unpaid or cancelled orders as revenue", async () => {
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 5000 }] });
    await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { source: "WHATSAPP" });
    const s = await financialSummary(resolvePeriod("today"));
    expect(s.grossSales).toBe(0);
    expect(s.cashCollected).toBe(0);
    expect(s.unpaidOrders).toBe(1);
    expect(s.unpaidAmount).toBe(5000);
  });
});
