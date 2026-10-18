import { db, type Tx } from "./db";

/** Recomputes the denormalised price/stock fields used for fast listing and filtering. */
export async function syncProductAggregates(productId: string, client: Tx | typeof db = db) {
  const variants = await client.productVariant.findMany({ where: { productId, isActive: true, deletedAt: null } });
  const prices = variants.map((v) => v.price);
  await client.product.update({
    where: { id: productId },
    data: {
      minPrice: prices.length ? Math.min(...prices) : 0,
      maxPrice: prices.length ? Math.max(...prices) : 0,
      inStock: variants.some((v) => !v.trackInventory || v.allowBackorder || v.stockOnHand > 0),
      hasCompareAt: variants.some((v) => v.compareAtPrice != null && v.compareAtPrice > v.price),
    },
  });
}

export async function syncRating(productId: string, client: Tx | typeof db = db) {
  const agg = await client.review.aggregate({ where: { productId, status: "APPROVED" }, _avg: { rating: true }, _count: true });
  await client.product.update({ where: { id: productId }, data: { ratingAvg: agg._avg.rating ?? 0, ratingCount: agg._count } });
}
