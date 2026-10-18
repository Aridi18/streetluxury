import { Prisma, type ContactMethod, type OrderSource, type OrderStatus } from "@prisma/client";
import { db, type Tx } from "./db";
import { UserError } from "./errors";
import { sha256 } from "./crypto";
import { computeTotals, type PromoRule } from "./pricing";
import { toPromoRule } from "./catalog";
import { availableQuantity, couponCustomerProblem, lineInputs } from "./cart";
import { deductStock } from "./inventory";
import { addHistory, orderAccessKey, refreshPaymentStatus } from "./order-core";
import { handleOrderPaid, mpgsConfigured } from "./payments";
import { notifyStaff } from "./notifications";
import { readSettings } from "./settings";
import { emailOrderPlaced, emailOwnerNewOrder } from "./emails";
import { isDigitalType } from "./fulfillment";

export type PlaceOrderInput = {
  cartId: string;
  userId: string | null;
  idempotencyKey: string;
  source: Extract<OrderSource, "WEBSITE" | "WHATSAPP">;
  customerName: string;
  email: string | null;
  phone: string; // normalised E.164 digits
  preferredContact: ContactMethod;
  deliveryMethod: "DELIVERY" | "PICKUP" | "NONE";
  zoneId: string | null;
  city: string | null;
  area: string | null;
  address: string | null;
  instructions: string | null;
  customerNote: string | null;
  paymentMethodId: string | null;
  ip: string | null;
};

export type PlacedOrder = { id: string; number: string; accessKey: string; total: number; status: OrderStatus; existing: boolean };

async function loadPromos(tx: Tx): Promise<PromoRule[]> {
  const now = new Date();
  const promos = await tx.promotion.findMany({
    where: { isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } } },
  });
  return promos.map(toPromoRule);
}

/**
 * Creates an order from a cart in a single database transaction:
 * prices, discounts, delivery fees, tax and stock are all re-validated here from the database.
 * Submitting the same idempotency key twice (double click, refresh, retry) returns the first order.
 */
export async function placeOrder(input: PlaceOrderInput): Promise<PlacedOrder> {
  const previous = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (previous) return { id: previous.id, number: previous.number, accessKey: orderAccessKey(previous.id), total: previous.total, status: previous.status, existing: true };

  const settings = await readSettings();
  if (!input.userId && !settings.guestCheckout) throw new UserError("Please sign in to place an order.");

  try {
    const order = await db.$transaction(
      async (tx) => {
        const cart = await tx.cart.findUnique({
          where: { id: input.cartId },
          include: { items: { where: { savedForLater: false }, orderBy: { createdAt: "asc" }, include: { variant: { include: { product: true } } } } },
        });
        if (!cart || cart.items.length === 0) throw new UserError("Your cart is empty.");

        for (const item of cart.items) {
          const v = item.variant;
          if (!v.isActive || v.deletedAt || v.product.status !== "ACTIVE" || v.product.deletedAt || v.product.isOnRequest) {
            throw new UserError(`“${v.product.title}” is no longer available. Please remove it from your cart.`);
          }
          if (item.quantity > availableQuantity(v)) throw new UserError(`Not enough stock for “${v.product.title}”. Please update your cart.`);
        }

        const requiresShipping = cart.items.some((i) => i.variant.product.type === "PHYSICAL");
        const hasDigital = cart.items.some((i) => isDigitalType(i.variant.product.type));

        // Delivery
        let zone: { id: string; name: string; fee: number; freeShippingThreshold: number | null } | null = null;
        let deliveryMethod = input.deliveryMethod;
        if (!requiresShipping) deliveryMethod = "NONE";
        else if (deliveryMethod === "PICKUP") {
          if (!settings.pickupEnabled) throw new UserError("Pickup is not available.");
        } else if (deliveryMethod === "DELIVERY") {
          zone = input.zoneId ? await tx.shippingZone.findFirst({ where: { id: input.zoneId, isActive: true } }) : null;
          if (!zone) throw new UserError("Choose your delivery area.");
          if (!input.city?.trim() || !input.address?.trim()) throw new UserError("Enter your city and delivery address.");
        } else if (input.source === "WEBSITE") {
          throw new UserError("Choose delivery or pickup.");
        }

        // Payment method
        let method = null as Awaited<ReturnType<typeof tx.paymentMethod.findUnique>>;
        if (input.paymentMethodId) {
          method = await tx.paymentMethod.findUnique({ where: { id: input.paymentMethodId } });
          if (!method || !method.isEnabled) throw new UserError("That payment method is not available. Please choose another.");
          if (method.appliesTo === "PHYSICAL_ONLY" && !requiresShipping) throw new UserError(`${method.name} is only available for physical deliveries.`);
          if (method.appliesTo === "DIGITAL_ONLY" && requiresShipping) throw new UserError(`${method.name} is only available for digital orders.`);
          if (method.kind === "ONLINE_CARD" && !mpgsConfigured()) throw new UserError("Online card payment is not available right now.");
        } else if (input.source === "WEBSITE") {
          throw new UserError("Choose a payment method.");
        }

        // Prices — recomputed from the database, never taken from the browser.
        const categories = await tx.category.findMany({ select: { id: true, parentId: true } });
        const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
        const promos = await loadPromos(tx);
        let coupon: PromoRule | null = null;
        if (cart.couponCode) {
          const promo = await tx.promotion.findUnique({ where: { code: cart.couponCode }, include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } } } });
          if (!promo) throw new UserError("The discount code in your cart is no longer valid. Please remove it.");
          coupon = toPromoRule(promo);
        }
        const customerProblem = coupon ? await couponCustomerProblem(coupon, { userId: input.userId, email: input.email, phone: input.phone }, tx) : null;
        const totals = computeTotals({
          lines: lineInputs(cart.items, parentOf),
          automaticPromos: promos,
          coupon,
          couponCustomerProblem: customerProblem,
          deliveryMethod: deliveryMethod === "NONE" ? "NONE" : deliveryMethod,
          zone,
          tax: { enabled: settings.taxEnabled, rateBps: settings.taxRateBps, inclusive: settings.taxInclusive },
          now: new Date(),
        });
        if (coupon && totals.coupon.error) throw new UserError(`Discount code: ${totals.coupon.error} Please remove it to continue.`);

        // Initial status
        let status: OrderStatus = "PENDING";
        if (input.source === "WEBSITE" && method && (method.kind === "MANUAL" || method.kind === "ONLINE_CARD")) status = "AWAITING_PAYMENT";
        const expiresAt = settings.unconfirmedOrderExpiryHours > 0 ? new Date(Date.now() + settings.unconfirmedOrderExpiryHours * 3600_000) : null;

        const [{ nextval }] = await tx.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('order_number_seq')`;
        const number = `DD-${nextval}`;

        const created = await tx.order.create({
          data: {
            number,
            accessTokenHash: "pending",
            idempotencyKey: input.idempotencyKey,
            userId: input.userId,
            source: input.source,
            status,
            customerName: input.customerName,
            email: input.email,
            phone: input.phone,
            preferredContact: input.preferredContact,
            requiresShipping,
            hasDigital,
            deliveryMethod,
            shippingZoneId: zone?.id ?? null,
            shippingZoneName: zone?.name ?? null,
            shipCity: deliveryMethod === "DELIVERY" ? input.city : null,
            shipArea: deliveryMethod === "DELIVERY" ? input.area : null,
            shipAddress: deliveryMethod === "DELIVERY" ? input.address : null,
            shipInstructions: deliveryMethod === "DELIVERY" ? input.instructions : null,
            customerNote: input.customerNote,
            currency: settings.currency,
            listSubtotal: totals.listSubtotal,
            subtotal: totals.subtotal,
            discountTotal: totals.discountTotal,
            couponDiscount: totals.couponDiscount,
            shippingTotal: totals.shippingTotal,
            taxTotal: totals.taxTotal,
            taxInclusive: totals.taxInclusive,
            total: totals.total,
            couponCode: totals.coupon.promo?.code ?? null,
            promotionId: totals.coupon.promo?.id ?? null,
            paymentMethodId: method?.id ?? null,
            paymentMethodName: method?.name ?? null,
            ip: input.ip,
            expiresAt: status === "PENDING" || status === "AWAITING_PAYMENT" ? expiresAt : null,
          },
        });
        await tx.order.update({ where: { id: created.id }, data: { accessTokenHash: sha256(orderAccessKey(created.id)) } });

        for (const [idx, item] of cart.items.entries()) {
          const priced = totals.lines[idx];
          const v = item.variant;
          const orderItem = await tx.orderItem.create({
            data: {
              orderId: created.id,
              productId: v.productId,
              variantId: v.id,
              productTitle: v.product.title,
              variantName: v.name,
              sku: v.sku,
              productType: v.product.type,
              listPrice: v.price,
              unitPrice: priced.unitPrice,
              unitCost: v.costPrice,
              quantity: item.quantity,
              couponDiscount: priced.couponDiscount,
              lineTotal: priced.lineTotal,
              customFields: item.customFields ?? {},
              customerNote: item.customerNote,
              durationDays: v.durationDays,
            },
          });
          const deducted = await deductStock(tx, v.id, item.quantity, { orderId: created.id, label: v.product.title });
          if (deducted) await tx.orderItem.update({ where: { id: orderItem.id }, data: { stockDeducted: true } });
          if (isDigitalType(v.product.type)) {
            await tx.digitalDelivery.create({ data: { orderId: created.id, orderItemId: orderItem.id } });
          }
        }

        if (totals.coupon.promo) {
          const claimed = await tx.promotion.updateMany({
            where: { id: totals.coupon.promo.id, OR: [{ usageLimit: null }, { usageCount: { lt: totals.coupon.promo.usageLimit ?? 0 } }] },
            data: { usageCount: { increment: 1 } },
          });
          if (!claimed.count) throw new UserError("This discount code has just reached its usage limit. Please remove it to continue.");
          await tx.promotionUsage.create({
            data: { promotionId: totals.coupon.promo.id, orderId: created.id, userId: input.userId, phone: input.phone, email: input.email, amount: totals.couponDiscount },
          });
        }

        await addHistory(tx, created.id, "ORDER", null, status, input.source === "WHATSAPP" ? "Order prepared for WhatsApp" : "Order placed on the website", null);
        if (created.total === 0) {
          const { becamePaid } = await refreshPaymentStatus(tx, created.id, null, "Nothing to pay");
          if (becamePaid) await handleOrderPaid(tx, created.id, null);
        }

        await tx.cartItem.deleteMany({ where: { cartId: cart.id, savedForLater: false } });
        await tx.cart.update({ where: { id: cart.id }, data: { couponCode: null } });
        await notifyStaff(
          { type: "new_order", title: `New ${input.source === "WHATSAPP" ? "WhatsApp " : ""}order ${number}`, body: `${input.customerName} · $${(created.total / 100).toFixed(2)}`, link: `/admin/orders/${created.id}`, permission: "orders.view" },
          tx,
        );
        return tx.order.findUniqueOrThrow({ where: { id: created.id }, include: { items: true } });
      },
      { timeout: 20_000 },
    );

    await Promise.all([emailOrderPlaced(order), emailOwnerNewOrder(order)]);
    return { id: order.id, number: order.number, accessKey: orderAccessKey(order.id), total: order.total, status: order.status, existing: false };
  } catch (err) {
    // Two identical submissions raced: return the one that won.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await db.order.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (winner) return { id: winner.id, number: winner.number, accessKey: orderAccessKey(winner.id), total: winner.total, status: winner.status, existing: true };
    }
    throw err;
  }
}

