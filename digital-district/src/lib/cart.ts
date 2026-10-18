import "server-only";
import { cookies } from "next/headers";
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "./db";
import { getCurrentUser } from "./auth";
import { randomToken, sha256 } from "./crypto";
import { env } from "./env";
import { UserError } from "./errors";
import { loadCategories, loadPromoRules, toPromoRule } from "./catalog";
import { categoryLineage, computeTotals, type CartLineInput, type PromoRule, type ZoneInput } from "./pricing";
import { getSettings } from "./settings";

export const CART_COOKIE = "dd_cart";
export const MAX_LINE_QUANTITY = 99;

export type CustomFieldDef = {
  key: string;
  label: string;
  type: "text" | "email" | "textarea" | "select";
  required: boolean;
  options?: string[];
  placeholder?: string;
};

export function parseCustomFieldDefs(json: Prisma.JsonValue): CustomFieldDef[] {
  if (!Array.isArray(json)) return [];
  return (json as unknown[])
    .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null && !Array.isArray(f))
    .map((f) => ({
      key: String(f.key ?? ""),
      label: String(f.label ?? ""),
      type: (["text", "email", "textarea", "select"].includes(String(f.type)) ? f.type : "text") as CustomFieldDef["type"],
      required: Boolean(f.required),
      options: Array.isArray(f.options) ? f.options.map(String) : undefined,
      placeholder: f.placeholder ? String(f.placeholder) : undefined,
    }))
    .filter((f) => f.key && f.label);
}

export function validateCustomFields(defs: CustomFieldDef[], values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of defs) {
    const value = (values[def.key] ?? "").trim().slice(0, 1000);
    if (!value) {
      if (def.required) throw new UserError(`Please fill in “${def.label}”.`);
      continue;
    }
    if (def.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new UserError(`“${def.label}” must be a valid email address.`);
    if (def.type === "select" && def.options && !def.options.includes(value)) throw new UserError(`Choose a valid option for “${def.label}”.`);
    out[def.key] = value;
  }
  return out;
}

// ───────────── Locating the cart ─────────────

const cartInclude = {
  items: {
    orderBy: { createdAt: "asc" },
    include: {
      variant: {
        include: {
          product: { include: { images: { orderBy: { sortOrder: "asc" }, take: 1 } } },
        },
      },
    },
  },
} satisfies Prisma.CartInclude;

export type CartWithItems = Prisma.CartGetPayload<{ include: typeof cartInclude }>;

async function guestTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(CART_COOKIE)?.value;
  return token ? sha256(token) : null;
}

/** The current visitor's cart, or null. Read-only: safe to call from server components. */
export async function findCart(): Promise<CartWithItems | null> {
  const user = await getCurrentUser();
  if (user) return db.cart.findUnique({ where: { userId: user.id }, include: cartInclude });
  const hash = await guestTokenHash();
  if (!hash) return null;
  return db.cart.findUnique({ where: { tokenHash: hash }, include: cartInclude });
}

/** Finds or creates the current visitor's cart. Only call from server actions (may set a cookie). */
export async function getOrCreateCart(): Promise<{ id: string }> {
  const user = await getCurrentUser();
  if (user) return db.cart.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {}, select: { id: true } });
  const hash = await guestTokenHash();
  if (hash) {
    const existing = await db.cart.findUnique({ where: { tokenHash: hash }, select: { id: true } });
    if (existing) return existing;
  }
  const token = randomToken();
  const cart = await db.cart.create({ data: { tokenHash: sha256(token) }, select: { id: true } });
  (await cookies()).set(CART_COOKIE, token, { httpOnly: true, secure: env.isProduction, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 60 });
  return cart;
}

/** After sign-in: moves the guest cart's items into the user's saved cart. */
export async function mergeGuestCart(userId: string) {
  const hash = await guestTokenHash();
  if (!hash) return;
  const guest = await db.cart.findUnique({ where: { tokenHash: hash }, include: { items: true } });
  if (!guest) return;
  await db.$transaction(async (tx) => {
    const userCart = await tx.cart.upsert({ where: { userId }, create: { userId }, update: {} });
    for (const item of guest.items) {
      const same = await tx.cartItem.findFirst({ where: { cartId: userCart.id, variantId: item.variantId, savedForLater: item.savedForLater } });
      if (same && JSON.stringify(same.customFields) === JSON.stringify(item.customFields)) {
        await tx.cartItem.update({ where: { id: same.id }, data: { quantity: Math.min(MAX_LINE_QUANTITY, same.quantity + item.quantity) } });
      } else {
        await tx.cartItem.update({ where: { id: item.id }, data: { cartId: userCart.id } });
      }
    }
    if (guest.couponCode && !userCart.couponCode) await tx.cart.update({ where: { id: userCart.id }, data: { couponCode: guest.couponCode } });
    await tx.cart.delete({ where: { id: guest.id } });
  });
  (await cookies()).delete(CART_COOKIE);
}

// ───────────── Mutations ─────────────

export function availableQuantity(v: { trackInventory: boolean; allowBackorder: boolean; stockOnHand: number }): number {
  if (!v.trackInventory || v.allowBackorder) return MAX_LINE_QUANTITY;
  return Math.max(0, v.stockOnHand);
}

async function sellableVariant(variantId: string) {
  const variant = await db.productVariant.findUnique({ where: { id: variantId }, include: { product: true } });
  if (!variant || !variant.isActive || variant.deletedAt || variant.product.status !== "ACTIVE" || variant.product.deletedAt) {
    throw new UserError("This product is no longer available.");
  }
  if (variant.product.isOnRequest) throw new UserError("This product is available on request. Please contact us on WhatsApp.");
  return variant;
}

export async function addToCart(input: { variantId: string; quantity: number; customFields?: Record<string, string>; note?: string }) {
  const quantity = Math.floor(input.quantity);
  if (!Number.isFinite(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) throw new UserError("Choose a quantity between 1 and 99.");
  const variant = await sellableVariant(input.variantId);
  const fields = validateCustomFields(parseCustomFieldDefs(variant.product.customFields), input.customFields ?? {});
  const note = variant.product.allowCustomerNote ? input.note?.trim().slice(0, 1000) || null : null;
  const cart = await getOrCreateCart();
  const existing = await db.cartItem.findFirst({ where: { cartId: cart.id, variantId: variant.id, savedForLater: false } });
  const sameFields = existing && JSON.stringify(existing.customFields) === JSON.stringify(fields);
  const newQty = sameFields ? existing.quantity + quantity : quantity;
  const max = availableQuantity(variant);
  if (max === 0) throw new UserError("Sorry, this item is out of stock.");
  if (newQty > max) throw new UserError(`Only ${max} available.`);
  if (sameFields) {
    await db.cartItem.update({ where: { id: existing.id }, data: { quantity: newQty, customerNote: note ?? existing.customerNote } });
  } else {
    await db.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity, customFields: fields, customerNote: note } });
  }
  await db.cart.update({ where: { id: cart.id }, data: { updatedAt: new Date() } });
}

async function ownedItem(itemId: string) {
  const cart = await findCart();
  const item = cart?.items.find((i) => i.id === itemId);
  if (!cart || !item) throw new UserError("That item is no longer in your cart.");
  return { cart, item };
}

export async function updateCartItem(itemId: string, quantity: number) {
  const { item } = await ownedItem(itemId);
  if (quantity <= 0) {
    await db.cartItem.delete({ where: { id: item.id } });
    return;
  }
  const q = Math.min(Math.floor(quantity), MAX_LINE_QUANTITY);
  const max = availableQuantity(item.variant);
  if (q > max) throw new UserError(max === 0 ? "This item is out of stock." : `Only ${max} available.`);
  await db.cartItem.update({ where: { id: item.id }, data: { quantity: q } });
}

export async function removeCartItem(itemId: string) {
  const { item } = await ownedItem(itemId);
  await db.cartItem.delete({ where: { id: item.id } });
}

export async function setSavedForLater(itemId: string, saved: boolean) {
  const { item } = await ownedItem(itemId);
  await db.cartItem.update({ where: { id: item.id }, data: { savedForLater: saved } });
}

export async function setCartCoupon(code: string | null) {
  const cart = await getOrCreateCart();
  await db.cart.update({ where: { id: cart.id }, data: { couponCode: code ? code.trim().toUpperCase().slice(0, 40) : null } });
}

// ───────────── Pricing a cart ─────────────

type PricingItem = {
  id: string;
  quantity: number;
  variant: { id: string; price: number; product: { id: string; categoryId: string | null; type: CartLineInput["productType"]; freeShipping: boolean; shippingSurcharge: number } };
};

export function lineInputs(items: PricingItem[], parentOf: Map<string, string | null>): CartLineInput[] {
  return items.map((i) => ({
    key: i.id,
    productId: i.variant.product.id,
    categoryIds: categoryLineage(i.variant.product.categoryId, parentOf),
    basePrice: i.variant.price,
    productType: i.variant.product.type,
    quantity: i.quantity,
    freeShipping: i.variant.product.freeShipping,
    shippingSurcharge: i.variant.product.shippingSurcharge,
  }));
}

export type CustomerIdentity = { userId?: string | null; email?: string | null; phone?: string | null };

/** Checks rules that depend on who is buying: per-customer limits and first-order offers. */
export async function couponCustomerProblem(promo: PromoRule, who: CustomerIdentity, client: Tx | typeof db = db): Promise<string | null> {
  const identity: Prisma.OrderWhereInput[] = [];
  if (who.userId) identity.push({ userId: who.userId });
  if (who.email) identity.push({ email: { equals: who.email, mode: "insensitive" } });
  if (who.phone) identity.push({ phone: who.phone });
  if (promo.firstOrderOnly) {
    if (!identity.length) return null; // re-checked at checkout once contact details are known
    const previous = await client.order.count({ where: { OR: identity, status: { notIn: ["CANCELLED"] } } });
    if (previous > 0) return "This code is only valid on your first order.";
  }
  if (promo.usageLimitPerCustomer != null && identity.length) {
    const usageIdentity: Prisma.PromotionUsageWhereInput[] = [];
    if (who.userId) usageIdentity.push({ userId: who.userId });
    if (who.email) usageIdentity.push({ email: { equals: who.email, mode: "insensitive" } });
    if (who.phone) usageIdentity.push({ phone: who.phone });
    const used = await client.promotionUsage.count({
      where: { promotionId: promo.id, OR: usageIdentity, order: { status: { notIn: ["CANCELLED"] } } },
    });
    if (used >= promo.usageLimitPerCustomer) return "You have already used this code the maximum number of times.";
  }
  return null;
}

export async function findCouponRule(code: string | null | undefined, client: Tx | typeof db = db): Promise<PromoRule | null | "invalid"> {
  if (!code) return null;
  const promo = await client.promotion.findUnique({
    where: { code: code.trim().toUpperCase() },
    include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } } },
  });
  return promo ? toPromoRule(promo) : "invalid";
}

export type CartIssue = { itemId: string; message: string };

/** Everything the cart and checkout pages need, priced on the server. */
export async function getCartView(opts: { deliveryMethod?: "DELIVERY" | "PICKUP"; zoneId?: string | null; customer?: CustomerIdentity } = {}) {
  const [cart, settings, promos, { parentOf }, user] = await Promise.all([findCart(), getSettings(), loadPromoRules(), loadCategories(), getCurrentUser()]);
  const items = cart?.items ?? [];
  const active = items.filter((i) => !i.savedForLater);
  const saved = items.filter((i) => i.savedForLater);

  const issues: CartIssue[] = [];
  for (const i of active) {
    const v = i.variant;
    if (!v.isActive || v.deletedAt || v.product.status !== "ACTIVE" || v.product.deletedAt || v.product.isOnRequest) {
      issues.push({ itemId: i.id, message: "No longer available — please remove it." });
    } else if (i.quantity > availableQuantity(v)) {
      const max = availableQuantity(v);
      issues.push({ itemId: i.id, message: max === 0 ? "Out of stock — please remove it." : `Only ${max} available — please lower the quantity.` });
    }
  }

  const zones = await db.shippingZone.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const zone = opts.zoneId ? zones.find((z) => z.id === opts.zoneId) ?? null : null;
  const couponLookup = await findCouponRule(cart?.couponCode);
  const coupon = couponLookup === "invalid" ? null : couponLookup;
  const customer = { userId: user?.id, ...opts.customer };
  const customerProblem = coupon ? await couponCustomerProblem(coupon, customer) : null;

  const totals = computeTotals({
    lines: lineInputs(active, parentOf),
    automaticPromos: promos,
    coupon,
    couponCustomerProblem: customerProblem,
    deliveryMethod: opts.deliveryMethod ?? (zone ? "DELIVERY" : "NONE"),
    zone: zone as ZoneInput | null,
    tax: { enabled: settings.taxEnabled, rateBps: settings.taxRateBps, inclusive: settings.taxInclusive },
    now: new Date(),
  });
  if (couponLookup === "invalid") totals.coupon = { promo: null, error: "This code is not valid." };

  return { cart, items: active, saved, totals, issues, zones, couponCode: cart?.couponCode ?? null, settings };
}

export async function cartItemCount(): Promise<number> {
  const cart = await findCart();
  return cart?.items.filter((i) => !i.savedForLater).reduce((s, i) => s + i.quantity, 0) ?? 0;
}
