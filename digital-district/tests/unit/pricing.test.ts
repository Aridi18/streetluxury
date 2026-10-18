import { describe, expect, it } from "vitest";
import { allocate, computeTotals, salePrice, type CartLineInput, type PromoRule } from "@/lib/pricing";
import { normalizePhone, formatPhone } from "@/lib/phone";
import { parseMoney, formatMoney } from "@/lib/money";
import { orderWhatsAppMessage, waLink } from "@/lib/whatsapp";
import { verifyTotp, totpCode, generateTotpSecret } from "@/lib/crypto";
import { canTransition, derivePaymentStatus } from "@/lib/order-status";
import { resolvePeriod, zonedMidnight } from "@/lib/time";

const now = new Date("2026-05-10T12:00:00Z");

function promo(p: Partial<PromoRule>): PromoRule {
  return {
    id: "p1", name: "Promo", code: null, type: "PERCENT", value: 1000, scope: "ALL", productIds: [], categoryIds: [],
    minOrderAmount: null, maxDiscount: null, usageLimit: null, usageLimitPerCustomer: null, usageCount: 0,
    firstOrderOnly: false, startsAt: null, endsAt: null, isActive: true, ...p,
  };
}

function line(p: Partial<CartLineInput>): CartLineInput {
  return { key: "l1", productId: "prod1", categoryIds: ["cat1"], basePrice: 1000, productType: "DIGITAL", quantity: 1, freeShipping: false, shippingSurcharge: 0, ...p };
}

describe("sale prices", () => {
  it("applies the best live automatic promotion", () => {
    const promos = [promo({ id: "a", value: 1000 }), promo({ id: "b", type: "FIXED", value: 300 })];
    expect(salePrice({ productId: "x", categoryIds: [], basePrice: 2000 }, promos, now)).toMatchObject({ unitPrice: 1700, promo: { id: "b" } });
  });
  it("ignores expired, future, coded and out-of-scope promotions", () => {
    const promos = [
      promo({ endsAt: new Date("2026-05-01") }),
      promo({ startsAt: new Date("2026-06-01") }),
      promo({ code: "SAVE" }),
      promo({ scope: "CATEGORIES", categoryIds: ["other"] }),
      promo({ isActive: false }),
    ];
    expect(salePrice({ productId: "x", categoryIds: ["cat1"], basePrice: 2000 }, promos, now).unitPrice).toBe(2000);
  });
  it("matches category promotions through ancestor categories", () => {
    const promos = [promo({ scope: "CATEGORIES", categoryIds: ["parent"], value: 5000 })];
    expect(salePrice({ productId: "x", categoryIds: ["child", "parent"], basePrice: 2000 }, promos, now).unitPrice).toBe(1000);
  });
  it("never goes below zero", () => {
    expect(salePrice({ productId: "x", categoryIds: [], basePrice: 200 }, [promo({ type: "FIXED", value: 500 })], now).unitPrice).toBe(0);
  });
});

describe("cart totals", () => {
  const tax = { enabled: false, rateBps: 0, inclusive: true };
  it("allocates a coupon across eligible lines exactly", () => {
    const t = computeTotals({
      lines: [line({ key: "a", basePrice: 1000, quantity: 1 }), line({ key: "b", productId: "prod2", basePrice: 2000, quantity: 1 })],
      automaticPromos: [], coupon: promo({ code: "TEN", type: "FIXED", value: 1000 }), deliveryMethod: "NONE", zone: null, tax, now,
    });
    expect(t.couponDiscount).toBe(1000);
    expect(t.lines.map((l) => l.couponDiscount)).toEqual([333, 667]);
    expect(t.total).toBe(2000);
  });
  it("enforces minimum order and scope", () => {
    const t = computeTotals({ lines: [line({})], automaticPromos: [], coupon: promo({ code: "MIN", minOrderAmount: 5000 }), deliveryMethod: "NONE", zone: null, tax, now });
    expect(t.coupon.error).toMatch(/minimum order/);
    expect(t.total).toBe(1000);
    const t2 = computeTotals({ lines: [line({})], automaticPromos: [], coupon: promo({ code: "X", scope: "PRODUCTS", productIds: ["nope"] }), deliveryMethod: "NONE", zone: null, tax, now });
    expect(t2.coupon.error).toMatch(/does not apply/);
  });
  it("caps percentage discounts with maxDiscount", () => {
    const t = computeTotals({ lines: [line({ basePrice: 10000 })], automaticPromos: [], coupon: promo({ code: "HALF", value: 5000, maxDiscount: 1500 }), deliveryMethod: "NONE", zone: null, tax, now });
    expect(t.couponDiscount).toBe(1500);
  });
  it("charges delivery for physical items and honours free shipping thresholds", () => {
    const zone = { id: "z", name: "Beirut", fee: 300, freeShippingThreshold: 5000 };
    const base = { automaticPromos: [], coupon: null, deliveryMethod: "DELIVERY" as const, zone, tax, now };
    expect(computeTotals({ ...base, lines: [line({ productType: "PHYSICAL", shippingSurcharge: 100, quantity: 2 })] }).shippingTotal).toBe(500);
    expect(computeTotals({ ...base, lines: [line({ productType: "PHYSICAL", basePrice: 6000 })] }).shippingTotal).toBe(0);
    expect(computeTotals({ ...base, lines: [line({ productType: "DIGITAL" })] }).shippingTotal).toBe(0);
    expect(computeTotals({ ...base, deliveryMethod: "PICKUP", lines: [line({ productType: "PHYSICAL" })] }).shippingTotal).toBe(0);
  });
  it("computes inclusive and exclusive tax", () => {
    const inc = computeTotals({ lines: [line({ basePrice: 11100 })], automaticPromos: [], coupon: null, deliveryMethod: "NONE", zone: null, tax: { enabled: true, rateBps: 1100, inclusive: true }, now });
    expect(inc.taxTotal).toBe(1100);
    expect(inc.total).toBe(11100);
    const exc = computeTotals({ lines: [line({ basePrice: 10000 })], automaticPromos: [], coupon: null, deliveryMethod: "NONE", zone: null, tax: { enabled: true, rateBps: 1100, inclusive: false }, now });
    expect(exc.total).toBe(11100);
  });
  it("allocate always sums to the amount", () => {
    for (const [amount, weights] of [[100, [1, 1, 1]], [7, [3, 0, 5]], [0, [1, 2]], [999, [1]]] as [number, number[]][]) {
      expect(allocate(amount, weights).reduce((a, b) => a + b, 0)).toBe(weights.some((w) => w > 0) ? amount : 0);
    }
  });
});

describe("helpers", () => {
  it("normalises Lebanese and international phone numbers", () => {
    expect(normalizePhone("81745567")).toBe("96181745567");
    expect(normalizePhone("03 123 456")).toBe("9613123456");
    expect(normalizePhone("+961 81 745 567")).toBe("96181745567");
    expect(normalizePhone("00961 81745567")).toBe("96181745567");
    expect(normalizePhone("+44 20 7946 0958")).toBe("442079460958");
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("+961 12")).toBeNull();
    expect(formatPhone("96181745567")).toBe("+961 81 745 567");
  });
  it("parses money safely", () => {
    expect(parseMoney("12")).toBe(1200);
    expect(parseMoney("12.5")).toBe(1250);
    expect(parseMoney("$1,250.99")).toBe(125099);
    expect(parseMoney("12.345")).toBeNull();
    expect(parseMoney("-3")).toBeNull();
    expect(formatMoney(350)).toBe("$3.50");
    expect(formatMoney(1400)).toBe("$14");
  });
  it("builds a properly encoded WhatsApp link", () => {
    const msg = orderWhatsAppMessage({
      number: "DD-100001", customerName: "Rami & Co", phone: "96170123456", currency: "USD",
      items: [{ productTitle: "Netflix", variantName: "1 Month", quantity: 2, unitPrice: 350, lineTotal: 700 }],
      subtotal: 700, discountTotal: 0, shippingTotal: 0, taxTotal: 0, taxInclusive: true, total: 700,
      requiresShipping: false, deliveryMethod: "NONE",
    });
    expect(msg).toContain("DD-100001");
    expect(msg).toContain("Netflix (1 Month) × 2 — $7");
    const link = waLink("+961 81 745 567", msg);
    expect(link.startsWith("https://wa.me/96181745567?text=")).toBe(true);
    expect(decodeURIComponent(link.split("text=")[1])).toBe(msg);
    expect(link).not.toContain("&Co");
  });
  it("verifies TOTP codes", () => {
    const secret = generateTotpSecret();
    const t = Date.now();
    expect(verifyTotp(secret, totpCode(secret, t), t)).toBe(true);
    expect(verifyTotp(secret, "000000", t) && totpCode(secret, t) !== "000000").toBe(false);
  });
  it("enforces order status transitions", () => {
    const o = { requiresShipping: false, pickup: false };
    expect(canTransition("PENDING", "CONFIRMED", o)).toBe(true);
    expect(canTransition("PENDING", "SHIPPED", o)).toBe(false);
    expect(canTransition("CONFIRMED", "SHIPPED", { requiresShipping: true, pickup: false })).toBe(true);
    expect(canTransition("COMPLETED", "PENDING", o)).toBe(false);
    expect(canTransition("CANCELLED", "CONFIRMED", o)).toBe(false);
  });
  it("derives payment status", () => {
    expect(derivePaymentStatus({ total: 1000, paidTotal: 0, refundedTotal: 0, hasPending: false, lastFailed: false })).toBe("UNPAID");
    expect(derivePaymentStatus({ total: 1000, paidTotal: 0, refundedTotal: 0, hasPending: true, lastFailed: false })).toBe("PENDING_VERIFICATION");
    expect(derivePaymentStatus({ total: 1000, paidTotal: 500, refundedTotal: 0, hasPending: false, lastFailed: false })).toBe("PARTIALLY_PAID");
    expect(derivePaymentStatus({ total: 1000, paidTotal: 1000, refundedTotal: 0, hasPending: false, lastFailed: false })).toBe("PAID");
    expect(derivePaymentStatus({ total: 1000, paidTotal: 1000, refundedTotal: 200, hasPending: false, lastFailed: false })).toBe("PARTIALLY_REFUNDED");
    expect(derivePaymentStatus({ total: 1000, paidTotal: 1000, refundedTotal: 1000, hasPending: false, lastFailed: false })).toBe("REFUNDED");
  });
  it("resolves periods in Beirut time", () => {
    // Beirut is UTC+3 in summer (DST): midnight local = 21:00 UTC the day before.
    expect(zonedMidnight("2026-07-01").toISOString()).toBe("2026-06-30T21:00:00.000Z");
    expect(zonedMidnight("2026-01-15").toISOString()).toBe("2026-01-14T22:00:00.000Z");
    const p = resolvePeriod("month", undefined, undefined, new Date("2026-07-15T10:00:00Z"));
    expect(p.fromYmd).toBe("2026-07-01");
    expect(p.to.toISOString()).toBe("2026-07-15T21:00:00.000Z");
  });
});
