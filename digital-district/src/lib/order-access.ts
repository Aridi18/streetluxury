import "server-only";
import { db } from "./db";
import { getCurrentUser } from "./auth";
import { hasPermission } from "./permissions";
import { verifyOrderAccessKey } from "./order-core";

export const orderViewInclude = {
  items: { include: { deliveries: true, reviews: { select: { id: true } }, product: { select: { slug: true, activationInstructions: true, images: { orderBy: { sortOrder: "asc" as const }, take: 1 } } } } },
  payments: { orderBy: { createdAt: "asc" as const } },
  refunds: { orderBy: { createdAt: "asc" as const } },
  shipments: { orderBy: { createdAt: "asc" as const } },
  history: { orderBy: { createdAt: "asc" as const } },
  paymentMethod: true,
};

/**
 * Loads an order only if the current visitor may see it: the signed-in customer who placed it,
 * anyone holding the order's secret access key (guests), or staff allowed to view orders.
 */
export async function loadOrderForViewer(number: string, key: string | null | undefined) {
  const order = await db.order.findUnique({ where: { number }, include: orderViewInclude });
  if (!order) return null;
  const user = await getCurrentUser();
  const isOwner = Boolean(user && order.userId === user.id);
  const isStaff = Boolean(user && hasPermission(user.role, "orders.view"));
  const hasKey = verifyOrderAccessKey(order.id, key);
  if (!isOwner && !isStaff && !hasKey) return null;
  return { order, viewer: { isOwner, isStaff, hasKey, user } };
}
