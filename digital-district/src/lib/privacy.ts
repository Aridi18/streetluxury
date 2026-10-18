import type { User } from "@prisma/client";
import { db } from "./db";
import { UserError } from "./errors";
import { audit } from "./audit";

/**
 * Deletes a customer's personal data while keeping anonymous sales records needed for accounting:
 * the account, addresses, sessions, wishlist and cart are removed; past orders keep amounts and items
 * but lose the name, phone, email and address.
 */
export async function anonymizeCustomer(actor: User, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "CUSTOMER") throw new UserError("Only customer accounts can be deleted here.");
  if (user.deletedAt) throw new UserError("This account has already been deleted.");
  await db.$transaction(async (tx) => {
    const orders = await tx.order.findMany({ where: { OR: [{ userId }, { email: user.email }] }, select: { id: true } });
    await tx.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { customerName: "Deleted customer", email: null, phone: "0", shipAddress: null, shipArea: null, shipCity: null, shipInstructions: null, customerNote: null, ip: null, userId: null, redactedAt: new Date() },
    });
    await tx.supportRequest.updateMany({ where: { userId }, data: { name: "Deleted customer", email: null, phone: null } });
    await tx.review.updateMany({ where: { userId }, data: { authorName: "Former customer", userId: null } });
    await tx.newsletterSubscriber.deleteMany({ where: { email: user.email } });
    await tx.address.deleteMany({ where: { userId } });
    await tx.session.deleteMany({ where: { userId } });
    await tx.cart.deleteMany({ where: { userId } });
    await tx.wishlistItem.deleteMany({ where: { userId } });
    await tx.userToken.deleteMany({ where: { userId } });
    await tx.customerNote.deleteMany({ where: { customerId: userId } });
    await tx.downloadLog.updateMany({ where: { userId }, data: { userId: null, ip: null } });
    await tx.user.update({
      where: { id: userId },
      data: { email: `deleted-${userId}@deleted.invalid`, name: "Deleted customer", phone: null, passwordHash: null, isActive: false, marketingOptIn: false, customerTags: [], deletedAt: new Date() },
    });
    await audit(actor, "customer.anonymize", "User", userId, `Deleted personal data (${orders.length} order(s) anonymised)`, undefined, tx);
  });
}
