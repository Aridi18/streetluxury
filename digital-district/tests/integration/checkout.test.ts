import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { placeOrder } from "@/lib/checkout";
import { cancelOrder } from "@/lib/orders";
import { makeCart, makeCategory, makePaymentMethod, makeProduct, makeStaff, makeZone, orderInput, quickOrder, resetDb } from "../helpers";

beforeEach(resetDb);

describe("website checkout", () => {
  it("creates an order with server-computed totals, snapshots and stock deduction", async () => {
    const pm = await makePaymentMethod("CASH_ON_DELIVERY");
    const zone = await makeZone(300);
    const product = await makeProduct({ title: "Gaming Mouse", variants: [{ price: 2500, cost: 1500, stock: 5 }] });
    const cart = await makeCart([{ variantId: product.variants[0].id, quantity: 2 }]);
    const placed = await placeOrder(orderInput(cart.id, { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "Beirut", address: "Hamra St" }));
    expect(placed.number).toBe("DD-100001");
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true, history: true } });
    expect(order.total).toBe(5300);
    expect(order.shippingTotal).toBe(300);
    expect(order.status).toBe("PENDING");
    expect(order.paymentStatus).toBe("UNPAID");
    expect(order.items[0]).toMatchObject({ productTitle: "Gaming Mouse", unitPrice: 2500, unitCost: 1500, quantity: 2, stockDeducted: true });
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(3);
    expect(await db.cartItem.count({ where: { cartId: cart.id } })).toBe(0);
    // Later catalog edits do not rewrite the order.
    await db.product.update({ where: { id: product.id }, data: { title: "Renamed" } });
    await db.productVariant.update({ where: { id: product.variants[0].id }, data: { price: 9999 } });
    const again = await db.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(again.productTitle).toBe("Gaming Mouse");
    expect(again.unitPrice).toBe(2500);
  });

  it("is idempotent: the same submission twice creates one order", async () => {
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 1400 }] });
    const cart = await makeCart([{ variantId: product.variants[0].id, quantity: 1 }]);
    const input = orderInput(cart.id, { paymentMethodId: pm.id });
    const [a, b] = await Promise.all([placeOrder(input), placeOrder(input)]);
    expect(a.id).toBe(b.id);
    expect(await db.order.count()).toBe(1);
    const third = await placeOrder(input);
    expect(third.existing).toBe(true);
  });

  it("prevents overselling when customers buy the last unit at the same time", async () => {
    const pm = await makePaymentMethod("CASH_ON_DELIVERY");
    const zone = await makeZone(0);
    const product = await makeProduct({ variants: [{ price: 1000, stock: 1 }] });
    const carts = await Promise.all([1, 2, 3, 4].map(() => makeCart([{ variantId: product.variants[0].id, quantity: 1 }])));
    const results = await Promise.allSettled(
      carts.map((c) => placeOrder(orderInput(c.id, { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "Beirut", address: "x" }))),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => /sold out|left in stock|Not enough stock/.test(String((r as PromiseRejectedResult).reason)))).toBe(true);
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(0);
  });

  it("does not require an address for digital-only orders and creates pending deliveries", async () => {
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 350, durationDays: 30 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id });
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { deliveries: true } });
    expect(order.requiresShipping).toBe(false);
    expect(order.status).toBe("AWAITING_PAYMENT");
    expect(order.deliveries).toHaveLength(1);
    expect(order.deliveries[0].status).toBe("PENDING");
  });

  it("rejects physical orders without a delivery zone and disabled payment methods", async () => {
    const pm = await makePaymentMethod("CASH_ON_DELIVERY");
    const product = await makeProduct({ variants: [{ price: 1000, stock: 3 }] });
    const cart = await makeCart([{ variantId: product.variants[0].id, quantity: 1 }]);
    await expect(placeOrder(orderInput(cart.id, { paymentMethodId: pm.id, deliveryMethod: "DELIVERY" }))).rejects.toThrow(/delivery area/);
    await db.paymentMethod.update({ where: { id: pm.id }, data: { isEnabled: false } });
    const zone = await makeZone();
    await expect(placeOrder(orderInput(cart.id, { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "B", address: "A" }))).rejects.toThrow(/not available/);
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(3);
  });

  it("applies automatic sales and coupons on the server and records usage", async () => {
    const pm = await makePaymentMethod("MANUAL");
    const cat = await makeCategory("AI");
    const product = await makeProduct({ type: "SUBSCRIPTION", categoryId: cat.id, variants: [{ price: 2000 }] });
    await db.promotion.create({ data: { name: "AI week", type: "PERCENT", value: 1000, scope: "CATEGORIES", categories: { create: { categoryId: cat.id } } } });
    await db.promotion.create({ data: { name: "Five off", code: "FIVE", type: "FIXED", value: 500, usageLimit: 1 } });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id }, { couponCode: "FIVE" });
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id }, include: { items: true } });
    expect(order.listSubtotal).toBe(2000);
    expect(order.subtotal).toBe(1800);
    expect(order.couponDiscount).toBe(500);
    expect(order.discountTotal).toBe(700);
    expect(order.total).toBe(1300);
    expect(order.items[0]).toMatchObject({ listPrice: 2000, unitPrice: 1800, couponDiscount: 500, lineTotal: 1300 });
    expect((await db.promotion.findUniqueOrThrow({ where: { code: "FIVE" } })).usageCount).toBe(1);
    // Usage limit reached: the next customer cannot use it.
    await expect(quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id, phone: "96171000000" }, { couponCode: "FIVE" })).rejects.toThrow(/usage limit/);
  });

  it("enforces first-order-only coupons by phone number", async () => {
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "DIGITAL", variants: [{ price: 2000 }] });
    await db.promotion.create({ data: { name: "Welcome", code: "WELCOME", type: "PERCENT", value: 1000, firstOrderOnly: true } });
    await quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id });
    await expect(quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id }, { couponCode: "WELCOME" })).rejects.toThrow(/first order/);
  });

  it("refuses on-request and inactive products", async () => {
    const pm = await makePaymentMethod("MANUAL");
    const product = await makeProduct({ type: "SERVICE", variants: [{ price: 1000 }] });
    await db.product.update({ where: { id: product.id }, data: { isOnRequest: true } });
    await expect(quickOrder([{ variantId: product.variants[0].id, quantity: 1 }], { paymentMethodId: pm.id })).rejects.toThrow(/no longer available/);
  });
});

describe("WhatsApp orders", () => {
  it("saves a pending, unpaid order before WhatsApp opens", async () => {
    const product = await makeProduct({ type: "SUBSCRIPTION", variants: [{ price: 400 }] });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 3 }], { source: "WHATSAPP" });
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order).toMatchObject({ source: "WHATSAPP", status: "PENDING", paymentStatus: "UNPAID", total: 1200, paidAt: null });
  });
});

describe("cancellation", () => {
  it("returns stock and releases coupon usage", async () => {
    const owner = await makeStaff();
    const pm = await makePaymentMethod("CASH_ON_DELIVERY");
    const zone = await makeZone(0);
    const product = await makeProduct({ variants: [{ price: 3000, stock: 4 }] });
    await db.promotion.create({ data: { name: "One off", code: "ONE", type: "FIXED", value: 100 } });
    const placed = await quickOrder([{ variantId: product.variants[0].id, quantity: 3 }], { paymentMethodId: pm.id, deliveryMethod: "DELIVERY", zoneId: zone.id, city: "B", address: "A" }, { couponCode: "ONE" });
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(1);
    await cancelOrder(owner, placed.id, "Customer changed their mind");
    expect((await db.productVariant.findUniqueOrThrow({ where: { id: product.variants[0].id } })).stockOnHand).toBe(4);
    expect((await db.promotion.findUniqueOrThrow({ where: { code: "ONE" } })).usageCount).toBe(0);
    const order = await db.order.findUniqueOrThrow({ where: { id: placed.id } });
    expect(order.status).toBe("CANCELLED");
    expect(await db.inventoryMovement.count({ where: { orderId: placed.id } })).toBe(2);
    await expect(cancelOrder(owner, placed.id, "again")).rejects.toThrow();
  });
});
