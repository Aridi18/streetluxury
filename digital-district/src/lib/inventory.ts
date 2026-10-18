import type { InventoryReason, User } from "@prisma/client";
import { db, type Tx } from "./db";
import { UserError } from "./errors";
import { notifyStaff } from "./notifications";
import { syncProductAggregates } from "./catalog-sync";
import { audit } from "./audit";

// Inventory policy (see docs/OPERATIONS.md):
// • Stock is deducted the moment an order is placed — website or WhatsApp — so two customers can never buy the last unit.
// • If the order is cancelled, rejected or auto-expired, the stock is returned automatically.
// • Refunded physical items return to stock only when staff tick "return to stock".
// • Variants with "track inventory" off (most digital services) are never limited by stock.

type Moved = { stockOnHand: number; lowStockThreshold: number; lowStockNotifiedAt: Date | null; productId: string; sku: string; name: string };

async function lowStockCheck(tx: Tx, variantId: string, row: Moved) {
  if (row.stockOnHand <= row.lowStockThreshold && !row.lowStockNotifiedAt) {
    await tx.productVariant.update({ where: { id: variantId }, data: { lowStockNotifiedAt: new Date() } });
    await notifyStaff(
      {
        type: "low_stock",
        title: row.stockOnHand <= 0 ? `Out of stock: ${row.sku}` : `Low stock: ${row.sku} (${row.stockOnHand} left)`,
        body: row.name,
        link: `/admin/inventory?q=${encodeURIComponent(row.sku)}`,
        permission: "inventory.manage",
      },
      tx,
    );
  } else if (row.stockOnHand > row.lowStockThreshold && row.lowStockNotifiedAt) {
    await tx.productVariant.update({ where: { id: variantId }, data: { lowStockNotifiedAt: null } });
  }
}

/**
 * Atomically removes stock for an order line. The conditional UPDATE runs under a row lock, so concurrent
 * checkouts for the last unit are serialised and only one succeeds. Returns false when the variant is not tracked.
 */
export async function deductStock(tx: Tx, variantId: string, quantity: number, ctx: { orderId: string; label: string }) {
  const rows = await tx.$queryRaw<Moved[]>`
    UPDATE "ProductVariant" v SET "stockOnHand" = v."stockOnHand" - ${quantity}, "updatedAt" = now()
    WHERE v.id = ${variantId} AND v."trackInventory" AND (v."allowBackorder" OR v."stockOnHand" >= ${quantity})
    RETURNING v."stockOnHand", v."lowStockThreshold", v."lowStockNotifiedAt", v."productId", v.sku, v.name`;
  if (!rows.length) {
    const v = await tx.productVariant.findUnique({ where: { id: variantId }, select: { trackInventory: true, stockOnHand: true } });
    if (v && !v.trackInventory) return false;
    throw new UserError(
      v && v.stockOnHand > 0 ? `Only ${v.stockOnHand} of “${ctx.label}” left in stock. Please update your cart.` : `“${ctx.label}” just sold out. Please update your cart.`,
    );
  }
  const row = rows[0];
  await tx.inventoryMovement.create({
    data: { variantId, delta: -quantity, quantityAfter: row.stockOnHand, reason: "ORDER_PLACED", orderId: ctx.orderId },
  });
  await lowStockCheck(tx, variantId, row);
  await syncProductAggregates(row.productId, tx);
  return true;
}

export async function restoreStock(tx: Tx, variantId: string, quantity: number, reason: InventoryReason, ctx: { orderId?: string; actorId?: string; note?: string } = {}) {
  if (quantity <= 0) return;
  const rows = await tx.$queryRaw<Moved[]>`
    UPDATE "ProductVariant" v SET "stockOnHand" = v."stockOnHand" + ${quantity}, "updatedAt" = now()
    WHERE v.id = ${variantId}
    RETURNING v."stockOnHand", v."lowStockThreshold", v."lowStockNotifiedAt", v."productId", v.sku, v.name`;
  if (!rows.length) return;
  await tx.inventoryMovement.create({
    data: { variantId, delta: quantity, quantityAfter: rows[0].stockOnHand, reason, orderId: ctx.orderId, actorId: ctx.actorId, note: ctx.note },
  });
  await lowStockCheck(tx, variantId, rows[0]);
  await syncProductAggregates(rows[0].productId, tx);
}

/** Manual stock change by staff: either a delta (+5 / -2) or an absolute count. Always audited. */
export async function adjustStock(actor: User, input: { variantId: string; mode: "delta" | "set"; value: number; reason: "MANUAL_ADJUSTMENT" | "STOCK_COUNT" | "DAMAGED"; note: string }) {
  if (!Number.isInteger(input.value)) throw new UserError("Enter a whole number.");
  if (!input.note.trim()) throw new UserError("Add a short note explaining the change.");
  await db.$transaction(async (tx) => {
    const [v] = await tx.$queryRaw<{ stockOnHand: number; productId: string; sku: string; allowBackorder: boolean }[]>`
      SELECT "stockOnHand", "productId", sku, "allowBackorder" FROM "ProductVariant" WHERE id = ${input.variantId} FOR UPDATE`;
    if (!v) throw new UserError("Variant not found.");
    const delta = input.mode === "set" ? input.value - v.stockOnHand : input.value;
    if (delta === 0) return;
    const after = v.stockOnHand + delta;
    if (after < 0 && !v.allowBackorder) throw new UserError("Stock cannot go below zero.");
    const updated = await tx.productVariant.update({ where: { id: input.variantId }, data: { stockOnHand: after }, include: { product: true } });
    await tx.inventoryMovement.create({ data: { variantId: input.variantId, delta, quantityAfter: after, reason: input.reason, note: input.note.trim(), actorId: actor.id } });
    await lowStockCheck(tx, input.variantId, { ...updated, productId: updated.productId, name: updated.product.title });
    await syncProductAggregates(v.productId, tx);
    await audit(actor, "inventory.adjust", "ProductVariant", input.variantId, `${v.sku}: ${v.stockOnHand} → ${after} (${input.note.trim()})`, { delta, reason: input.reason }, tx);
  });
}

/**
 * Receives a supplier purchase: adds stock and updates each variant's cost using the weighted-average method
 * (new cost = (old stock × old cost + received × purchase cost) ÷ new stock). Shipping and other purchase costs
 * are spread over the items by value so the inventory cost reflects what the goods really cost.
 */
export async function receivePurchase(
  actor: User,
  input: { supplierId: string | null; reference: string | null; purchasedAt: Date; shippingCost: number; otherCosts: number; notes: string | null; items: { variantId: string; quantity: number; unitCost: number }[] },
) {
  if (!input.items.length) throw new UserError("Add at least one item.");
  for (const i of input.items) {
    if (!Number.isInteger(i.quantity) || i.quantity <= 0) throw new UserError("Quantities must be positive whole numbers.");
    if (i.unitCost < 0) throw new UserError("Costs cannot be negative.");
  }
  const itemsTotal = input.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
  const extra = input.shippingCost + input.otherCosts;
  return db.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: {
        supplierId: input.supplierId,
        reference: input.reference,
        purchasedAt: input.purchasedAt,
        itemsTotal,
        shippingCost: input.shippingCost,
        otherCosts: input.otherCosts,
        total: itemsTotal + extra,
        notes: input.notes,
        createdById: actor.id,
      },
    });
    for (const item of input.items) {
      const lineValue = item.quantity * item.unitCost;
      const share = itemsTotal > 0 ? (extra * lineValue) / itemsTotal : extra / input.items.length;
      const landedUnitCost = Math.round(item.unitCost + share / item.quantity);
      const [v] = await tx.$queryRaw<{ stockOnHand: number; costPrice: number; productId: string }[]>`
        SELECT "stockOnHand", "costPrice", "productId" FROM "ProductVariant" WHERE id = ${item.variantId} FOR UPDATE`;
      if (!v) throw new UserError("One of the variants no longer exists.");
      const before = Math.max(0, v.stockOnHand);
      const newCost = before + item.quantity > 0 ? Math.round((before * v.costPrice + item.quantity * landedUnitCost) / (before + item.quantity)) : landedUnitCost;
      const after = v.stockOnHand + item.quantity;
      await tx.productVariant.update({ where: { id: item.variantId }, data: { stockOnHand: after, costPrice: newCost } });
      await tx.purchaseItem.create({ data: { purchaseId: purchase.id, variantId: item.variantId, quantity: item.quantity, unitCost: landedUnitCost } });
      await tx.inventoryMovement.create({
        data: { variantId: item.variantId, delta: item.quantity, quantityAfter: after, reason: "PURCHASE_RECEIVED", unitCost: landedUnitCost, purchaseId: purchase.id, actorId: actor.id },
      });
      const moved = await tx.productVariant.findUniqueOrThrow({ where: { id: item.variantId }, include: { product: true } });
      await lowStockCheck(tx, item.variantId, { ...moved, name: moved.product.title });
      await syncProductAggregates(v.productId, tx);
    }
    await audit(actor, "purchase.receive", "Purchase", purchase.id, `Received ${input.items.length} line(s), total ${(itemsTotal + extra) / 100}`, undefined, tx);
    return purchase;
  });
}
