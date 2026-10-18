import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";

/** Personal data export for the signed-in customer (no secrets: no password hash, delivery content or keys). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const [addresses, orders, reviews, wishlist, support, newsletter] = await Promise.all([
    db.address.findMany({ where: { userId: user.id } }),
    db.order.findMany({ where: { userId: user.id }, include: { items: { select: { productTitle: true, variantName: true, quantity: true, unitPrice: true, lineTotal: true } }, payments: { select: { methodName: true, amount: true, status: true, reference: true, createdAt: true } } } }),
    db.review.findMany({ where: { userId: user.id } }),
    db.wishlistItem.findMany({ where: { userId: user.id }, include: { product: { select: { title: true } } } }),
    db.supportRequest.findMany({ where: { userId: user.id } }),
    db.newsletterSubscriber.findUnique({ where: { email: user.email } }),
  ]);
  const data = {
    exportedAt: new Date().toISOString(),
    profile: { name: user.name, email: user.email, phone: user.phone, createdAt: user.createdAt, marketingOptIn: user.marketingOptIn, emailVerifiedAt: user.emailVerifiedAt },
    addresses,
    orders: orders.map((o) => ({ number: o.number, placedAt: o.placedAt, status: o.status, paymentStatus: o.paymentStatus, total: o.total / 100, currency: o.currency, shipping: { city: o.shipCity, area: o.shipArea, address: o.shipAddress }, items: o.items, payments: o.payments })),
    reviews,
    wishlist: wishlist.map((w) => w.product.title),
    supportRequests: support,
    newsletter: newsletter ? { subscribedAt: newsletter.consentAt, unsubscribedAt: newsletter.unsubscribedAt, consentText: newsletter.consentText } : null,
  };
  return new Response(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="digital-district-my-data.json"`, "Cache-Control": "no-store" },
  });
}
