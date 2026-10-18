"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { readSettings } from "@/lib/settings";
import { syncRating } from "@/lib/catalog-sync";
import { notifyStaff } from "@/lib/notifications";

export async function toggleWishlistAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "/");
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(returnTo.startsWith("/") ? returnTo : "/")}`);
  const existing = await db.wishlistItem.findUnique({ where: { userId_productId: { userId: user.id, productId } } });
  if (existing) await db.wishlistItem.delete({ where: { userId_productId: { userId: user.id, productId } } });
  else if (await db.product.findFirst({ where: { id: productId, status: "ACTIVE", deletedAt: null } })) await db.wishlistItem.create({ data: { userId: user.id, productId } });
  revalidatePath(returnTo.startsWith("/") ? returnTo : "/");
  revalidatePath("/account/wishlist");
}

const reviewSchema = z.object({
  orderItemId: z.string().min(1),
  rating: z.coerce.number().int().min(1, "Choose a rating.").max(5),
  title: z.string().trim().max(120).optional(),
  body: z.string().trim().min(10, "Write at least 10 characters.").max(3000),
});

/** Only customers who received the product can review it (verified purchase), once per order item. */
export async function submitReviewAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const user = await getCurrentUser();
    if (!user) return { ok: false, error: "Please sign in to leave a review." };
    const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
    const item = await db.orderItem.findUnique({ where: { id: parsed.data.orderItemId }, include: { order: true, reviews: true } });
    if (!item || item.order.userId !== user.id || !item.productId) return { ok: false, error: "You can only review products you bought." };
    if (!["DELIVERED", "COMPLETED", "PARTIALLY_REFUNDED"].includes(item.order.status) && item.fulfilledQuantity === 0) return { ok: false, error: "You can review this product once your order has been delivered." };
    if (item.reviews.length) return { ok: false, error: "You have already reviewed this purchase." };
    const settings = await readSettings();
    await db.review.create({
      data: {
        productId: item.productId,
        userId: user.id,
        orderItemId: item.id,
        authorName: user.name.split(" ")[0] + (user.name.split(" ")[1] ? ` ${user.name.split(" ")[1][0]}.` : ""),
        rating: parsed.data.rating,
        title: parsed.data.title || null,
        body: parsed.data.body,
        status: settings.reviewsRequireApproval ? "PENDING" : "APPROVED",
      },
    });
    if (!settings.reviewsRequireApproval) await syncRating(item.productId);
    else await notifyStaff({ type: "review", title: `New review to approve (${parsed.data.rating}★)`, body: item.productTitle, link: "/admin/reviews", permission: "reviews.moderate" });
    revalidatePath("/account/orders");
    return { ok: true, message: settings.reviewsRequireApproval ? "Thanks! Your review will appear once it has been checked." : "Thanks for your review!" };
  } catch (err) {
    return toActionError(err);
  }
}
