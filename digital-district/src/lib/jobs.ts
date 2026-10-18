// Scheduled maintenance, run every ~15 minutes by the scheduler (see docs/DEPLOYMENT.md).
import { db } from "./db";
import { cancelOrder } from "./orders";
import { readSettings } from "./settings";
import { renderEmail, sendEmail } from "./email";
import { notifyStaff } from "./notifications";
import { orderUrl } from "./order-core";

/** Cancels orders nobody confirmed or paid in time, returning their reserved stock. */
export async function expireUnconfirmedOrders(now = new Date()) {
  const stale = await db.order.findMany({
    where: { status: { in: ["PENDING", "AWAITING_PAYMENT"] }, expiresAt: { lt: now }, paidTotal: 0, paymentStatus: { in: ["UNPAID", "FAILED"] } },
    select: { id: true },
    take: 200,
  });
  let cancelled = 0;
  for (const o of stale) {
    try {
      await cancelOrder(null, o.id, "Automatically cancelled: the order was not confirmed or paid in time.");
      cancelled++;
    } catch (err) {
      console.error("expireUnconfirmedOrders", o.id, err);
    }
  }
  return cancelled;
}

/** Reminds customers (and staff) before a subscription ends. */
export async function sendRenewalReminders(now = new Date()) {
  const settings = await readSettings();
  if (settings.renewalReminderDays <= 0) return 0;
  const until = new Date(now.getTime() + settings.renewalReminderDays * 86400_000);
  const due = await db.digitalDelivery.findMany({
    where: { status: "DELIVERED", renewalReminderSentAt: null, expiresAt: { gt: now, lte: until }, order: { status: { notIn: ["CANCELLED", "REFUNDED"] } } },
    include: { order: true, orderItem: true },
    take: 200,
  });
  for (const d of due) {
    const what = `${d.orderItem.productTitle}${d.orderItem.variantName !== "Default" ? ` (${d.orderItem.variantName})` : ""}`;
    const ends = d.expiresAt!.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Beirut" });
    await sendEmail(d.order.email, `Your ${d.orderItem.productTitle} plan ends on ${ends}`, "renewal_reminder", renderEmail({
      heading: "Time to renew?",
      paragraphs: [`Hi ${d.order.customerName}, your ${what} from order ${d.order.number} ends on ${ends}.`, "Renew now to keep uninterrupted access — reply on WhatsApp or order again from your account."],
      button: { label: "View your order", url: orderUrl(d.order) },
    }));
    await notifyStaff({ type: "renewal_due", title: `Renewal due: ${what}`, body: `${d.order.customerName} · ends ${ends}`, link: `/admin/orders/${d.orderId}`, permission: "orders.view" });
    await db.digitalDelivery.update({ where: { id: d.id }, data: { renewalReminderSentAt: now } });
  }
  return due.length;
}

export async function cleanup(now = new Date()) {
  const day = 86400_000;
  const [sessions, tokens, limits, carts, notifications] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.userToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - day) } }, { usedAt: { lt: new Date(now.getTime() - 7 * day) } }] } }),
    db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(now.getTime() - day) } } }),
    db.cart.deleteMany({ where: { userId: null, updatedAt: { lt: new Date(now.getTime() - 60 * day) } } }),
    db.notification.deleteMany({ where: { readAt: { lt: new Date(now.getTime() - 90 * day) } } }),
  ]);
  return { sessions: sessions.count, tokens: tokens.count, rateLimits: limits.count, carts: carts.count, notifications: notifications.count };
}

export async function runScheduledJobs() {
  const started = Date.now();
  const expired = await expireUnconfirmedOrders();
  const reminders = await sendRenewalReminders();
  const cleaned = await cleanup();
  return { expiredOrders: expired, renewalReminders: reminders, cleaned, ms: Date.now() - started };
}
