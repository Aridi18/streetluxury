import type { ProductType, UserRole } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { syncProductAggregates } from "@/lib/catalog-sync";
import { placeOrder, type PlaceOrderInput } from "@/lib/checkout";

export async function resetDb() {
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  await db.$executeRawUnsafe(`ALTER SEQUENCE order_number_seq RESTART WITH 100001`);
}

let counter = 0;
const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeStaff(role: UserRole = "OWNER") {
  return db.user.create({ data: { email: `${role.toLowerCase()}-${uid()}@test.local`, name: `${role} user`, role } });
}

export async function makeCategory(name = "Category", parentId: string | null = null) {
  return db.category.create({ data: { name, slug: `${name.toLowerCase().replace(/\W+/g, "-")}-${uid()}`, parentId } });
}

export async function makeProduct(opts: {
  title?: string;
  type?: ProductType;
  categoryId?: string | null;
  variants?: { name?: string; price: number; cost?: number; stock?: number; track?: boolean; backorder?: boolean; durationDays?: number | null; compareAt?: number }[];
  deliveryMode?: "MANUAL" | "AUTOMATIC";
  freeShipping?: boolean;
  shippingSurcharge?: number;
} = {}) {
  const type = opts.type ?? "PHYSICAL";
  const variants = opts.variants ?? [{ price: 1000 }];
  const product = await db.product.create({
    data: {
      title: opts.title ?? `Product ${uid()}`,
      slug: `p-${uid()}`,
      type,
      status: "ACTIVE",
      categoryId: opts.categoryId ?? null,
      digitalDeliveryMode: opts.deliveryMode ?? "MANUAL",
      freeShipping: opts.freeShipping ?? false,
      shippingSurcharge: opts.shippingSurcharge ?? 0,
      variants: {
        create: variants.map((v, i) => ({
          sku: `SKU-${uid()}`,
          name: v.name ?? (variants.length === 1 ? "Default" : `Variant ${i + 1}`),
          price: v.price,
          compareAtPrice: v.compareAt ?? null,
          costPrice: v.cost ?? 0,
          trackInventory: v.track ?? type === "PHYSICAL",
          stockOnHand: v.stock ?? 0,
          allowBackorder: v.backorder ?? false,
          durationDays: v.durationDays ?? null,
          isDefault: i === 0,
          sortOrder: i,
        })),
      },
    },
    include: { variants: { orderBy: { sortOrder: "asc" } } },
  });
  await syncProductAggregates(product.id);
  return product;
}

export async function makePaymentMethod(kind: "MANUAL" | "CASH_ON_DELIVERY" | "ONLINE_CARD" = "MANUAL", extra: Partial<{ feePercentBps: number; feeFixed: number; appliesTo: "ALL" | "PHYSICAL_ONLY" | "DIGITAL_ONLY"; requiresReference: boolean; allowProofUpload: boolean }> = {}) {
  return db.paymentMethod.create({
    data: { code: `${kind.toLowerCase()}-${uid()}`, name: kind === "MANUAL" ? "Whish Money" : kind === "CASH_ON_DELIVERY" ? "Cash on delivery" : "Card", kind, isEnabled: true, instructions: "Send to 81 000 000", allowProofUpload: true, ...extra },
  });
}

export async function makeZone(fee = 300, freeShippingThreshold: number | null = null) {
  return db.shippingZone.create({ data: { name: `Zone ${uid()}`, fee, freeShippingThreshold, areas: ["Beirut"] } });
}

export async function makeCart(items: { variantId: string; quantity: number }[], opts: { userId?: string; couponCode?: string } = {}) {
  return db.cart.create({
    data: { userId: opts.userId, tokenHash: opts.userId ? null : randomUUID(), couponCode: opts.couponCode, items: { create: items } },
  });
}

export function orderInput(cartId: string, overrides: Partial<PlaceOrderInput> = {}): PlaceOrderInput {
  return {
    cartId,
    userId: null,
    idempotencyKey: randomUUID(),
    source: "WEBSITE",
    customerName: "Test Customer",
    email: "customer@test.local",
    phone: "96170123456",
    preferredContact: "WHATSAPP",
    deliveryMethod: "NONE",
    zoneId: null,
    city: null,
    area: null,
    address: null,
    instructions: null,
    customerNote: null,
    paymentMethodId: null,
    ip: "127.0.0.1",
    ...overrides,
  };
}

export async function quickOrder(items: { variantId: string; quantity: number }[], overrides: Partial<PlaceOrderInput> = {}, cartOpts: { couponCode?: string; userId?: string } = {}) {
  const cart = await makeCart(items, cartOpts);
  return placeOrder(orderInput(cart.id, overrides));
}
