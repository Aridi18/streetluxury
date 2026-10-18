import type { ShipmentStatus, User } from "@prisma/client";
import { db, type Tx } from "./db";
import { UserError } from "./errors";
import { decrypt, encrypt, sha256 } from "./crypto";
import { addHistory, setOrderStatus } from "./order-core";
import { notifyStaff } from "./notifications";
import { readSettings } from "./settings";
import { audit } from "./audit";
import { emailDeliveryReady, emailShipped } from "./emails";
import { restoreStock } from "./inventory";

type Actor = Pick<User, "id" | "name"> | null;

const DIGITAL_TYPES = ["DIGITAL", "SUBSCRIPTION", "LICENSE", "SERVICE"] as const;

export function isDigitalType(t: string) {
  return (DIGITAL_TYPES as readonly string[]).includes(t);
}

/**
 * Runs automatic digital delivery for a paid order: assigns licence keys from the key pool and grants access
 * to downloadable files. Items without keys or files stay pending for manual delivery by staff.
 */
export async function autoFulfillDigital(tx: Tx, orderId: string, actor: Actor) {
  const settings = await readSettings();
  const deliveries = await tx.digitalDelivery.findMany({
    where: { orderId, status: "PENDING" },
    include: { orderItem: { include: { product: { include: { digitalAssets: { where: { isActive: true } } } } } } },
  });
  let delivered = 0;
  for (const d of deliveries) {
    const item = d.orderItem;
    const product = item.product;
    if (!product || product.digitalDeliveryMode !== "AUTOMATIC") continue;
    const assets = product.digitalAssets.filter((a) => !a.variantId || a.variantId === item.variantId);
    const variant = item.variantId ? await tx.productVariant.findUnique({ where: { id: item.variantId }, select: { _count: { select: { licenseKeys: true } } } }) : null;
    const usesKeys = (variant?._count.licenseKeys ?? 0) > 0;
    if (!usesKeys && assets.length === 0) continue; // nothing automatic configured: manual delivery

    let keyIds: string[] = [];
    if (usesKeys) {
      const keys = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM "LicenseKey" WHERE "variantId" = ${item.variantId} AND status = 'AVAILABLE'
        ORDER BY "createdAt" LIMIT ${item.quantity} FOR UPDATE SKIP LOCKED`;
      if (keys.length < item.quantity) {
        await tx.digitalDelivery.update({ where: { id: d.id }, data: { status: "FAILED", failureReason: `Not enough licence keys in stock (${keys.length} of ${item.quantity}). Add keys and retry.` } });
        await notifyStaff({ type: "delivery_failed", title: `Delivery failed: ${item.productTitle}`, body: "Licence keys ran out", link: `/admin/orders/${orderId}`, permission: "orders.fulfill" }, tx);
        continue;
      }
      keyIds = keys.map((k) => k.id);
      await tx.licenseKey.updateMany({ where: { id: { in: keyIds } }, data: { status: "ASSIGNED", assignedAt: new Date() } });
    }
    const now = new Date();
    await tx.digitalDelivery.update({
      where: { id: d.id },
      data: {
        status: "DELIVERED",
        licenseKeyIds: keyIds,
        assetIds: assets.map((a) => a.id),
        downloadExpiresAt: assets.length && settings.downloadExpiryDays > 0 ? new Date(now.getTime() + settings.downloadExpiryDays * 86400_000) : null,
        maxDownloads: assets.length && settings.maxDownloads > 0 ? settings.maxDownloads * item.quantity : null,
        startsAt: now,
        expiresAt: item.durationDays ? new Date(now.getTime() + item.durationDays * 86400_000) : null,
        deliveredAt: now,
      },
    });
    await tx.orderItem.update({ where: { id: item.id }, data: { fulfilledQuantity: item.quantity } });
    delivered++;
  }
  if (delivered) {
    await addHistory(tx, orderId, "ORDER", null, "DIGITAL_DELIVERED", `${delivered} item(s) delivered automatically`, actor);
    await maybeCompleteOrder(tx, orderId, actor);
  }
  return delivered;
}

/** Digital-only orders that are paid and fully delivered move to Completed automatically. */
export async function maybeCompleteOrder(tx: Tx, orderId: string, actor: Actor) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { deliveries: true, items: true } });
  if (["CANCELLED", "COMPLETED", "REFUNDED"].includes(order.status)) return;
  const digitalDone = order.deliveries.every((d) => d.status === "DELIVERED" || d.status === "REVOKED");
  const physicalDone = order.items.filter((i) => i.productType === "PHYSICAL").every((i) => i.fulfilledQuantity >= i.quantity - i.refundedQuantity);
  const paid = order.paymentStatus === "PAID" || order.paymentStatus === "PARTIALLY_REFUNDED";
  if (digitalDone && physicalDone && paid && !order.requiresShipping) {
    await setOrderStatus(tx, order, "COMPLETED", "All items delivered", actor);
  } else if (!digitalDone && order.deliveries.some((d) => d.status === "DELIVERED") && ["CONFIRMED", "PENDING", "AWAITING_PAYMENT"].includes(order.status)) {
    await setOrderStatus(tx, order, "PROCESSING", "Some items delivered", actor);
  }
}

export async function deliverManually(actor: User, deliveryId: string, input: { content: string; startsAt: Date | null; expiresAt: Date | null; internalNote: string | null }) {
  const content = input.content.trim();
  if (!content) throw new UserError("Enter the delivery details the customer should see (access details, instructions, links…).");
  if (content.length > 10000) throw new UserError("Delivery details are too long.");
  const order = await db.$transaction(async (tx) => {
    const d = await tx.digitalDelivery.findUnique({ where: { id: deliveryId }, include: { orderItem: true, order: true } });
    if (!d) throw new UserError("Delivery not found.");
    if (d.order.status === "CANCELLED") throw new UserError("This order is cancelled.");
    const now = new Date();
    const startsAt = input.startsAt ?? d.startsAt ?? now;
    const expiresAt = input.expiresAt ?? (d.orderItem.durationDays ? new Date(startsAt.getTime() + d.orderItem.durationDays * 86400_000) : null);
    await tx.digitalDelivery.update({
      where: { id: deliveryId },
      data: { status: "DELIVERED", contentEnc: encrypt(content), startsAt, expiresAt, deliveredAt: now, deliveredById: actor.id, failureReason: null, internalNote: input.internalNote },
    });
    await tx.orderItem.update({ where: { id: d.orderItemId }, data: { fulfilledQuantity: d.orderItem.quantity } });
    await addHistory(tx, d.orderId, "ORDER", null, "DIGITAL_DELIVERED", `${d.orderItem.productTitle} delivered`, actor);
    await maybeCompleteOrder(tx, d.orderId, actor);
    await audit(actor, "delivery.deliver", "DigitalDelivery", deliveryId, `Delivered ${d.orderItem.productTitle} on ${d.order.number}`, undefined, tx);
    return tx.order.findUniqueOrThrow({ where: { id: d.orderId } });
  });
  await emailDeliveryReady(order);
}

export async function setDeliveryState(actor: User, deliveryId: string, state: "PROCESSING" | "FAILED" | "REVOKED" | "PENDING", reason: string | null) {
  if ((state === "FAILED" || state === "REVOKED") && !reason?.trim()) throw new UserError("Give a reason.");
  await db.$transaction(async (tx) => {
    const d = await tx.digitalDelivery.findUnique({ where: { id: deliveryId }, include: { orderItem: true, order: true } });
    if (!d) throw new UserError("Delivery not found.");
    if (state === "REVOKED" && d.licenseKeyIds.length) {
      await tx.licenseKey.updateMany({ where: { id: { in: d.licenseKeyIds } }, data: { status: "REVOKED" } });
    }
    await tx.digitalDelivery.update({ where: { id: deliveryId }, data: { status: state, failureReason: state === "FAILED" || state === "REVOKED" ? reason : null } });
    await addHistory(tx, d.orderId, "ORDER", null, `DIGITAL_${state}`, `${d.orderItem.productTitle}${reason ? `: ${reason}` : ""}`, actor);
    await audit(actor, `delivery.${state.toLowerCase()}`, "DigitalDelivery", deliveryId, `${d.orderItem.productTitle} on ${d.order.number}${reason ? `: ${reason}` : ""}`, undefined, tx);
  });
}

/** Retries automatic delivery after staff fix the cause (e.g. added licence keys). */
export async function retryAutoDelivery(actor: User, deliveryId: string) {
  const d = await db.digitalDelivery.findUnique({ where: { id: deliveryId }, include: { order: true } });
  if (!d) throw new UserError("Delivery not found.");
  if (!["PAID", "PARTIALLY_REFUNDED"].includes(d.order.paymentStatus)) throw new UserError("Automatic delivery runs only after the order is paid.");
  await db.digitalDelivery.update({ where: { id: deliveryId }, data: { status: "PENDING", failureReason: null } });
  const count = await db.$transaction((tx) => autoFulfillDigital(tx, d.orderId, actor));
  if (count) await emailDeliveryReady(d.order);
  return count;
}

export function readDeliveryContent(contentEnc: string | null): string | null {
  if (!contentEnc) return null;
  try {
    return decrypt(contentEnc);
  } catch {
    return "[Delivery details could not be decrypted — check DATA_ENCRYPTION_KEY]";
  }
}

// ───────────── Licence keys ─────────────

export async function addLicenseKeys(actor: User, variantId: string, raw: string) {
  const lines = raw.split(/\r?\n/).map((c) => c.trim()).filter(Boolean);
  const codes = [...new Set(lines)];
  if (!codes.length) throw new UserError("Paste at least one key (one per line).");
  if (codes.length > 5000) throw new UserError("Add at most 5,000 keys at a time.");
  return db.$transaction(async (tx) => {
    const variant = await tx.productVariant.findUnique({ where: { id: variantId } });
    if (!variant) throw new UserError("Variant not found.");
    const hashes = codes.map((c) => sha256(`${variantId}:${c}`));
    const existing = new Set((await tx.licenseKey.findMany({ where: { codeHash: { in: hashes } }, select: { codeHash: true } })).map((k) => k.codeHash));
    const fresh = codes.map((c, i) => ({ c, h: hashes[i] })).filter((x) => !existing.has(x.h));
    if (fresh.length) {
      await tx.licenseKey.createMany({ data: fresh.map((x) => ({ variantId, codeEnc: encrypt(x.c), codeHash: x.h, createdById: actor.id })) });
      if (!variant.trackInventory) await tx.productVariant.update({ where: { id: variantId }, data: { trackInventory: true, stockOnHand: 0 } });
      await restoreStock(tx, variantId, fresh.length, "LICENSE_KEYS_ADDED", { actorId: actor.id, note: `${fresh.length} key(s) added` });
    }
    await audit(actor, "license.add", "ProductVariant", variantId, `Added ${fresh.length} key(s), skipped ${lines.length - fresh.length} duplicate(s)`, undefined, tx);
    return { added: fresh.length, duplicates: lines.length - fresh.length };
  });
}

export async function revealLicenseKeys(ids: string[]) {
  if (!ids.length) return [];
  const keys = await db.licenseKey.findMany({ where: { id: { in: ids } } });
  return keys.map((k) => ({ id: k.id, status: k.status, code: (() => { try { return decrypt(k.codeEnc); } catch { return "[unreadable]"; } })() }));
}

// ───────────── Physical shipments ─────────────

export async function createShipment(
  actor: User,
  orderId: string,
  input: { items: { orderItemId: string; quantity: number }[]; courier: string | null; trackingNumber: string | null; trackingUrl: string | null; shippingCost: number; status: "PREPARING" | "SHIPPED" | "READY_FOR_PICKUP"; note: string | null },
) {
  const items = input.items.filter((i) => i.quantity > 0);
  if (!items.length) throw new UserError("Choose at least one item and quantity to fulfil.");
  if (input.trackingUrl && !/^https?:\/\//i.test(input.trackingUrl)) throw new UserError("The tracking link must start with http:// or https://");
  const order = await db.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new UserError("Order not found.");
    if (["CANCELLED", "REFUNDED", "PENDING", "AWAITING_PAYMENT"].includes(order.status)) throw new UserError("Confirm the order before fulfilling it.");
    for (const i of items) {
      const line = order.items.find((x) => x.id === i.orderItemId);
      if (!line || line.productType !== "PHYSICAL") throw new UserError("Only physical items can be shipped.");
      const remaining = line.quantity - line.refundedQuantity - line.fulfilledQuantity;
      if (!Number.isInteger(i.quantity) || i.quantity > remaining) throw new UserError(`Only ${remaining} of “${line.productTitle}” left to fulfil.`);
    }
    const now = new Date();
    const shipment = await tx.shipment.create({
      data: {
        orderId,
        status: input.status,
        courier: input.courier,
        trackingNumber: input.trackingNumber,
        trackingUrl: input.trackingUrl,
        shippingCost: input.shippingCost,
        items,
        note: input.note,
        shippedAt: input.status === "SHIPPED" ? now : null,
        createdById: actor.id,
      },
    });
    for (const i of items) await tx.orderItem.update({ where: { id: i.orderItemId }, data: { fulfilledQuantity: { increment: i.quantity } } });
    if (input.shippingCost > 0) {
      const category = await tx.expenseCategory.upsert({ where: { name: "Shipping & courier" }, create: { name: "Shipping & courier", isOperating: true }, update: {} });
      await tx.expense.create({
        data: { categoryId: category.id, amount: input.shippingCost, incurredAt: now, description: `Courier for ${order.number}`, vendor: input.courier, orderId, createdById: actor.id },
      });
    }
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: true } });
    const physical = fresh.items.filter((i) => i.productType === "PHYSICAL");
    const allDone = physical.every((i) => i.fulfilledQuantity >= i.quantity - i.refundedQuantity);
    const target = !allDone ? "PARTIALLY_FULFILLED" : input.status === "READY_FOR_PICKUP" ? "READY_FOR_PICKUP" : input.status === "SHIPPED" ? "SHIPPED" : "PROCESSING";
    if (fresh.status !== target) await setOrderStatus(tx, fresh, target, `Shipment ${shipment.id.slice(-6)} created`, actor);
    await audit(actor, "shipment.create", "Order", orderId, `Shipment for ${order.number}${input.trackingNumber ? ` (${input.trackingNumber})` : ""}`, undefined, tx);
    return fresh;
  });
  if (input.status === "SHIPPED") await emailShipped(order, input);
}

export async function updateShipmentStatus(actor: User, shipmentId: string, status: ShipmentStatus, tracking?: { courier?: string | null; trackingNumber?: string | null; trackingUrl?: string | null }) {
  const result = await db.$transaction(async (tx) => {
    const s = await tx.shipment.findUnique({ where: { id: shipmentId }, include: { order: { include: { shipments: true, items: true } } } });
    if (!s) throw new UserError("Shipment not found.");
    const now = new Date();
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status,
        ...(tracking ?? {}),
        ...(status === "SHIPPED" && !s.shippedAt ? { shippedAt: now } : {}),
        ...(status === "DELIVERED" ? { deliveredAt: now } : {}),
      },
    });
    if (status === "RETURNED" || status === "FAILED") {
      // Items come back: allow them to be fulfilled again.
      for (const i of s.items as { orderItemId: string; quantity: number }[]) {
        await tx.orderItem.update({ where: { id: i.orderItemId }, data: { fulfilledQuantity: { decrement: i.quantity } } });
      }
    }
    const order = s.order;
    const shipments = await tx.shipment.findMany({ where: { orderId: order.id } });
    const physical = await tx.orderItem.findMany({ where: { orderId: order.id, productType: "PHYSICAL" } });
    const allFulfilled = physical.every((i) => i.fulfilledQuantity >= i.quantity - i.refundedQuantity);
    const allDelivered = allFulfilled && shipments.filter((x) => x.status !== "RETURNED" && x.status !== "FAILED").every((x) => x.status === "DELIVERED");
    if (allDelivered && !["DELIVERED", "COMPLETED", "CANCELLED", "REFUNDED"].includes(order.status)) {
      await setOrderStatus(tx, order, "DELIVERED", "All shipments delivered", actor);
    } else if (status === "SHIPPED" && allFulfilled && ["CONFIRMED", "PROCESSING", "PARTIALLY_FULFILLED"].includes(order.status)) {
      await setOrderStatus(tx, order, "SHIPPED", null, actor);
    } else if ((status === "RETURNED" || status === "FAILED") && !allFulfilled && ["SHIPPED", "DELIVERED", "READY_FOR_PICKUP"].includes(order.status)) {
      await setOrderStatus(tx, order, "PARTIALLY_FULFILLED", `Shipment ${status.toLowerCase()}`, actor);
    }
    await audit(actor, "shipment.status", "Shipment", shipmentId, `${order.number}: ${status}`, undefined, tx);
    return { order: await tx.order.findUniqueOrThrow({ where: { id: order.id } }), shipment: s };
  });
  if (status === "SHIPPED") await emailShipped(result.order, { courier: tracking?.courier ?? result.shipment.courier, trackingNumber: tracking?.trackingNumber ?? result.shipment.trackingNumber, trackingUrl: tracking?.trackingUrl ?? result.shipment.trackingUrl });
}
