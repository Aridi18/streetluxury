// Pure pricing logic shared by the cart, checkout and product pages.
// Every total a customer pays is computed here on the server; browser-submitted totals are never trusted.
import type { ProductType, PromotionScope, PromotionType } from "@prisma/client";
import { percentOf } from "./money";

export type PromoRule = {
  id: string;
  name: string;
  code: string | null;
  type: PromotionType;
  value: number; // bps for PERCENT, cents for FIXED
  scope: PromotionScope;
  productIds: string[];
  categoryIds: string[];
  minOrderAmount: number | null;
  maxDiscount: number | null;
  usageLimit: number | null;
  usageLimitPerCustomer: number | null;
  usageCount: number;
  firstOrderOnly: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
};

export type PriceableItem = {
  productId: string;
  categoryIds: string[]; // the product's category and all its ancestors
  basePrice: number;
};

export type CartLineInput = PriceableItem & {
  key: string;
  productType: ProductType;
  quantity: number;
  freeShipping: boolean;
  shippingSurcharge: number;
};

export type ZoneInput = { id: string; name: string; fee: number; freeShippingThreshold: number | null };

export type TaxInput = { enabled: boolean; rateBps: number; inclusive: boolean };

export function isPromoLive(p: Pick<PromoRule, "isActive" | "startsAt" | "endsAt" | "usageLimit" | "usageCount">, now: Date): boolean {
  if (!p.isActive) return false;
  if (p.startsAt && p.startsAt > now) return false;
  if (p.endsAt && p.endsAt <= now) return false;
  if (p.usageLimit != null && p.usageCount >= p.usageLimit) return false;
  return true;
}

export function promoAppliesTo(p: Pick<PromoRule, "scope" | "productIds" | "categoryIds">, item: Pick<PriceableItem, "productId" | "categoryIds">): boolean {
  if (p.scope === "ALL") return true;
  if (p.scope === "PRODUCTS") return p.productIds.includes(item.productId);
  return item.categoryIds.some((c) => p.categoryIds.includes(c));
}

/** Price after the best automatic (code-less) sale that applies. */
export function salePrice(item: PriceableItem, automaticPromos: PromoRule[], now: Date): { unitPrice: number; promo: PromoRule | null } {
  let best = item.basePrice;
  let bestPromo: PromoRule | null = null;
  for (const p of automaticPromos) {
    if (p.code || !isPromoLive(p, now) || !promoAppliesTo(p, item)) continue;
    let price = item.basePrice;
    if (p.type === "PERCENT") price = item.basePrice - percentOf(item.basePrice, p.value);
    else if (p.type === "FIXED") price = item.basePrice - p.value;
    else continue;
    price = Math.max(0, price);
    if (price < best) {
      best = price;
      bestPromo = p;
    }
  }
  return { unitPrice: best, promo: bestPromo };
}

/** Splits `amount` across `weights` proportionally, so the parts always add up exactly. */
export function allocate(amount: number, weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || amount <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (amount * w) / total);
  const floors = raw.map(Math.floor);
  let remainder = amount - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
  for (const { i } of order) {
    if (remainder <= 0) break;
    floors[i] += 1;
    remainder -= 1;
  }
  return floors;
}

export type PricedLine = CartLineInput & {
  unitPrice: number;
  salePromoId: string | null;
  lineSubtotal: number;
  couponDiscount: number;
  lineTotal: number;
};

export type Totals = {
  lines: PricedLine[];
  listSubtotal: number;
  subtotal: number;
  saleDiscount: number;
  couponDiscount: number;
  discountTotal: number;
  requiresShipping: boolean;
  shippingTotal: number;
  freeShippingReason: string | null;
  taxTotal: number;
  taxInclusive: boolean;
  total: number;
  coupon: { promo: PromoRule; error: null } | { promo: null; error: string | null };
};

export function couponStaticProblem(coupon: PromoRule, lines: { categoryIds: string[]; productId: string; lineSubtotal: number }[], subtotal: number, now: Date): string | null {
  if (!isPromoLive(coupon, now)) {
    if (coupon.endsAt && coupon.endsAt <= now) return "This code has expired.";
    if (coupon.startsAt && coupon.startsAt > now) return "This code is not active yet.";
    if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) return "This code has reached its usage limit.";
    return "This code is not valid.";
  }
  if (coupon.minOrderAmount != null && subtotal < coupon.minOrderAmount) return `This code needs a minimum order of $${(coupon.minOrderAmount / 100).toFixed(2)}.`;
  if (!lines.some((l) => promoAppliesTo(coupon, l))) return "This code does not apply to the items in your cart.";
  return null;
}

export function computeTotals(input: {
  lines: CartLineInput[];
  automaticPromos: PromoRule[];
  coupon: PromoRule | null;
  couponCustomerProblem?: string | null; // result of customer-specific checks done by the caller
  deliveryMethod: "DELIVERY" | "PICKUP" | "NONE";
  zone: ZoneInput | null;
  tax: TaxInput;
  now: Date;
}): Totals {
  const { now } = input;
  const lines: PricedLine[] = input.lines.map((l) => {
    const { unitPrice, promo } = salePrice(l, input.automaticPromos, now);
    const lineSubtotal = unitPrice * l.quantity;
    return { ...l, unitPrice, salePromoId: promo?.id ?? null, lineSubtotal, couponDiscount: 0, lineTotal: lineSubtotal };
  });
  const listSubtotal = lines.reduce((s, l) => s + l.basePrice * l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.lineSubtotal, 0);

  // Coupon
  let coupon: Totals["coupon"] = { promo: null, error: null };
  let couponDiscount = 0;
  let couponFreeShipping = false;
  if (input.coupon) {
    const problem = couponStaticProblem(input.coupon, lines, subtotal, now) ?? input.couponCustomerProblem ?? null;
    if (problem) {
      coupon = { promo: null, error: problem };
    } else {
      const c = input.coupon;
      const eligible = lines.map((l) => (promoAppliesTo(c, l) ? l.lineSubtotal : 0));
      const eligibleSubtotal = eligible.reduce((a, b) => a + b, 0);
      if (c.type === "PERCENT") couponDiscount = percentOf(eligibleSubtotal, c.value);
      else if (c.type === "FIXED") couponDiscount = Math.min(c.value, eligibleSubtotal);
      else couponFreeShipping = true;
      if (c.maxDiscount != null) couponDiscount = Math.min(couponDiscount, c.maxDiscount);
      couponDiscount = Math.min(couponDiscount, eligibleSubtotal);
      const parts = allocate(couponDiscount, eligible);
      lines.forEach((l, i) => {
        l.couponDiscount = parts[i];
        l.lineTotal = l.lineSubtotal - parts[i];
      });
      coupon = { promo: c, error: null };
    }
  }

  const goodsTotal = subtotal - couponDiscount;

  // Shipping
  const physical = lines.filter((l) => l.productType === "PHYSICAL");
  const requiresShipping = physical.length > 0;
  let shippingTotal = 0;
  let freeShippingReason: string | null = null;
  if (requiresShipping && input.deliveryMethod === "DELIVERY" && input.zone) {
    const surcharges = physical.filter((l) => !l.freeShipping).reduce((s, l) => s + l.shippingSurcharge * l.quantity, 0);
    shippingTotal = input.zone.fee + surcharges;
    if (physical.every((l) => l.freeShipping)) freeShippingReason = "Free delivery on these items";
    else if (input.zone.freeShippingThreshold != null && goodsTotal >= input.zone.freeShippingThreshold) freeShippingReason = "Free delivery threshold reached";
    else if (couponFreeShipping) freeShippingReason = "Free delivery code applied";
    if (freeShippingReason) shippingTotal = 0;
  }

  // Tax
  let taxTotal = 0;
  let total = goodsTotal + shippingTotal;
  if (input.tax.enabled && input.tax.rateBps > 0) {
    if (input.tax.inclusive) {
      taxTotal = Math.round(total - (total * 10000) / (10000 + input.tax.rateBps));
    } else {
      taxTotal = percentOf(total, input.tax.rateBps);
      total += taxTotal;
    }
  }

  const saleDiscount = listSubtotal - subtotal;
  return {
    lines,
    listSubtotal,
    subtotal,
    saleDiscount,
    couponDiscount,
    discountTotal: saleDiscount + couponDiscount,
    requiresShipping,
    shippingTotal,
    freeShippingReason,
    taxTotal,
    taxInclusive: input.tax.inclusive,
    total,
    coupon,
  };
}

/** Category id plus all ancestor ids, given a parent lookup. */
export function categoryLineage(categoryId: string | null, parentOf: Map<string, string | null>): string[] {
  const out: string[] = [];
  let current = categoryId;
  const seen = new Set<string>();
  while (current && !seen.has(current)) {
    seen.add(current);
    out.push(current);
    current = parentOf.get(current) ?? null;
  }
  return out;
}
