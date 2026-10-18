import "server-only";
import { cache } from "react";
import type { Prisma, ProductType } from "@prisma/client";
import { db, type Tx } from "./db";
import { categoryLineage, isPromoLive, salePrice, type PromoRule } from "./pricing";

// ───────────── Shared lookups (memoised per request) ─────────────

export const loadPromoRules = cache(async (): Promise<PromoRule[]> => {
  const now = new Date();
  const promos = await db.promotion.findMany({
    where: { isActive: true, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    include: { products: { select: { productId: true } }, categories: { select: { categoryId: true } } },
  });
  return promos.map(toPromoRule);
});

export function toPromoRule(
  p: Prisma.PromotionGetPayload<{ include: { products: { select: { productId: true } }; categories: { select: { categoryId: true } } } }>,
): PromoRule {
  return {
    id: p.id,
    name: p.name,
    code: p.code,
    type: p.type,
    value: p.value,
    scope: p.scope,
    productIds: p.products.map((x) => x.productId),
    categoryIds: p.categories.map((x) => x.categoryId),
    minOrderAmount: p.minOrderAmount,
    maxDiscount: p.maxDiscount,
    usageLimit: p.usageLimit,
    usageLimitPerCustomer: p.usageLimitPerCustomer,
    usageCount: p.usageCount,
    firstOrderOnly: p.firstOrderOnly,
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    isActive: p.isActive,
  };
}

export const loadCategories = cache(async () => {
  const categories = await db.category.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  return { categories, parentOf };
});

/** Ids of a category and all of its descendants. */
export function descendantIds(rootId: string, categories: { id: string; parentId: string | null }[]): string[] {
  const out = [rootId];
  for (let i = 0; i < out.length; i++) for (const c of categories) if (c.parentId === out[i] && !out.includes(c.id)) out.push(c.id);
  return out;
}

export const PUBLIC_PRODUCT_WHERE: Prisma.ProductWhereInput = { status: "ACTIVE", deletedAt: null };

// ───────────── Product cards ─────────────

export const productCardInclude = {
  images: { orderBy: { sortOrder: "asc" }, take: 1 },
  variants: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" } },
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { name: true, slug: true } },
} satisfies Prisma.ProductInclude;

type CardSource = Prisma.ProductGetPayload<{ include: typeof productCardInclude }>;

export type ProductCard = {
  id: string;
  slug: string;
  title: string;
  shortDescription: string | null;
  imageKey: string | null;
  imageAlt: string;
  badge: string | null;
  type: ProductType;
  isOnRequest: boolean;
  priceFrom: number | null; // effective (after sale) lowest price
  wasPrice: number | null; // struck-through price for the lowest-priced variant
  discountPercent: number | null;
  multiplePrices: boolean;
  inStock: boolean;
  ratingAvg: number;
  ratingCount: number;
  categoryName: string | null;
  brandName: string | null;
  saleEndsAt: Date | null;
  defaultVariantId: string | null; // set when the product has exactly one variant (quick add)
};

export function toProductCard(p: CardSource, promos: PromoRule[], parentOf: Map<string, string | null>, now = new Date()): ProductCard {
  const categoryIds = categoryLineage(p.categoryId, parentOf);
  let best: { price: number; was: number | null; endsAt: Date | null } | null = null;
  const prices = new Set<number>();
  for (const v of p.variants) {
    const { unitPrice, promo } = salePrice({ productId: p.id, categoryIds, basePrice: v.price }, promos, now);
    prices.add(unitPrice);
    const was = v.compareAtPrice && v.compareAtPrice > unitPrice ? v.compareAtPrice : unitPrice < v.price ? v.price : null;
    if (!best || unitPrice < best.price) best = { price: unitPrice, was, endsAt: promo?.endsAt ?? null };
  }
  const inStock = p.variants.some((v) => !v.trackInventory || v.allowBackorder || v.stockOnHand > 0);
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    shortDescription: p.shortDescription,
    imageKey: p.images[0]?.key ?? null,
    imageAlt: p.images[0]?.alt || p.title,
    badge: p.badge,
    type: p.type,
    isOnRequest: p.isOnRequest || p.variants.length === 0,
    priceFrom: p.isOnRequest || !best ? null : best.price,
    wasPrice: p.isOnRequest || !best ? null : best.was,
    discountPercent: best?.was ? Math.round(((best.was - best.price) / best.was) * 100) : null,
    multiplePrices: prices.size > 1,
    inStock,
    ratingAvg: p.ratingAvg,
    ratingCount: p.ratingCount,
    categoryName: p.category?.name ?? null,
    brandName: p.brand?.name ?? null,
    saleEndsAt: best?.endsAt ?? null,
    defaultVariantId: p.variants.length === 1 ? p.variants[0].id : null,
  };
}

export async function productCards(where: Prisma.ProductWhereInput, orderBy: Prisma.ProductOrderByWithRelationInput[], take: number, skip = 0) {
  const [products, promos, { parentOf }] = await Promise.all([
    db.product.findMany({ where: { AND: [PUBLIC_PRODUCT_WHERE, where] }, include: productCardInclude, orderBy, take, skip }),
    loadPromoRules(),
    loadCategories(),
  ]);
  const now = new Date();
  return products.map((p) => toProductCard(p, promos, parentOf, now));
}

/** Product ids currently covered by a live automatic sale (for "on sale" filters and the offers section). */
export async function onSaleWhere(): Promise<Prisma.ProductWhereInput> {
  const [promos, { categories }] = await Promise.all([loadPromoRules(), loadCategories()]);
  const now = new Date();
  const live = promos.filter((p) => !p.code && p.type !== "FREE_SHIPPING" && isPromoLive(p, now));
  if (live.some((p) => p.scope === "ALL")) return {};
  const productIds = live.flatMap((p) => (p.scope === "PRODUCTS" ? p.productIds : []));
  const categoryIds = live.flatMap((p) => (p.scope === "CATEGORIES" ? p.categoryIds.flatMap((c) => descendantIds(c, categories)) : []));
  return { OR: [{ hasCompareAt: true }, { id: { in: productIds } }, { categoryId: { in: categoryIds } }] };
}

// ───────────── Search & listing ─────────────

export type SortKey = "relevance" | "newest" | "price-asc" | "price-desc" | "popular" | "bestsellers";

export type SearchParams = {
  q?: string;
  categorySlug?: string;
  brandSlug?: string;
  type?: ProductType;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
  onSale?: boolean;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
};

function termWhere(term: string): Prisma.ProductWhereInput {
  const contains = { contains: term, mode: "insensitive" as const };
  return {
    OR: [
      { title: contains },
      { shortDescription: contains },
      { description: contains },
      { badge: contains },
      { brand: { name: contains } },
      { category: { name: contains } },
      { tags: { some: { tag: { name: contains } } } },
      { variants: { some: { sku: contains, deletedAt: null } } },
      { variants: { some: { name: contains, deletedAt: null } } },
    ],
  };
}

export function searchTerms(q: string | undefined): string[] {
  return (q ?? "")
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[%_\\]/g, "").trim())
    .filter((t) => t.length > 0)
    .slice(0, 6);
}

function relevanceScore(p: { title: string; shortDescription: string | null; badge: string | null; brand: { name: string } | null; category: { name: string } | null; salesCount: number }, terms: string[], phrase: string) {
  const title = p.title.toLowerCase();
  let score = 0;
  if (title === phrase) score += 100;
  if (title.startsWith(phrase)) score += 40;
  for (const t of terms) {
    if (title.split(/\W+/).includes(t)) score += 20;
    else if (title.includes(t)) score += 12;
    if (p.brand?.name.toLowerCase().includes(t)) score += 8;
    if (p.category?.name.toLowerCase().includes(t)) score += 5;
    if (p.shortDescription?.toLowerCase().includes(t)) score += 3;
  }
  return score + Math.min(p.salesCount, 50) / 10;
}

export async function searchProducts(params: SearchParams) {
  const pageSize = Math.min(Math.max(params.pageSize ?? 24, 1), 60);
  const page = Math.max(params.page ?? 1, 1);
  const terms = searchTerms(params.q);
  const and: Prisma.ProductWhereInput[] = [PUBLIC_PRODUCT_WHERE, ...terms.map(termWhere)];

  const { categories } = await loadCategories();
  let category = null as (typeof categories)[number] | null;
  if (params.categorySlug) {
    category = categories.find((c) => c.slug === params.categorySlug && c.isVisible) ?? null;
    if (!category) return { items: [], total: 0, page, pageSize, category: null, terms };
    and.push({ categoryId: { in: descendantIds(category.id, categories) } });
  }
  if (params.brandSlug) and.push({ brand: { slug: params.brandSlug } });
  if (params.type) and.push({ type: params.type });
  if (params.minPrice != null) and.push({ maxPrice: { gte: params.minPrice }, isOnRequest: false });
  if (params.maxPrice != null) and.push({ minPrice: { lte: params.maxPrice }, isOnRequest: false });
  if (params.inStock) and.push({ inStock: true, isOnRequest: false });
  if (params.onSale) and.push(await onSaleWhere());
  const where: Prisma.ProductWhereInput = { AND: and };

  const sort: SortKey = params.sort ?? (terms.length ? "relevance" : "popular");
  const total = await db.product.count({ where });

  if (sort === "relevance" && terms.length) {
    const candidates = await db.product.findMany({
      where,
      select: { id: true, title: true, shortDescription: true, badge: true, salesCount: true, brand: { select: { name: true } }, category: { select: { name: true } } },
      take: 1000,
    });
    const phrase = terms.join(" ");
    const ranked = candidates.map((p) => ({ id: p.id, score: relevanceScore(p, terms, phrase) })).sort((a, b) => b.score - a.score);
    const pageIds = ranked.slice((page - 1) * pageSize, page * pageSize).map((r) => r.id);
    const cards = await productCards({ id: { in: pageIds } }, [], pageSize);
    const byId = new Map(cards.map((c) => [c.id, c]));
    return { items: pageIds.map((id) => byId.get(id)!).filter(Boolean), total, page, pageSize, category, terms };
  }

  const orderBy: Prisma.ProductOrderByWithRelationInput[] =
    sort === "newest"
      ? [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }]
      : sort === "price-asc"
        ? [{ isOnRequest: "asc" }, { minPrice: "asc" }]
        : sort === "price-desc"
          ? [{ isOnRequest: "asc" }, { maxPrice: "desc" }]
          : sort === "bestsellers"
            ? [{ salesCount: "desc" }, { isBestseller: "desc" }, { sortOrder: "asc" }]
            : [{ isFeatured: "desc" }, { viewCount: "desc" }, { salesCount: "desc" }, { sortOrder: "asc" }];
  const items = await productCards(where, [...orderBy, { id: "asc" }], pageSize, (page - 1) * pageSize);
  return { items, total, page, pageSize, category, terms };
}

export async function searchSuggestions(q: string) {
  const terms = searchTerms(q);
  if (!terms.length) return { products: [], categories: [] };
  const [products, { categories }] = await Promise.all([
    db.product.findMany({
      where: { AND: [PUBLIC_PRODUCT_WHERE, ...terms.map(termWhere)] },
      select: { title: true, slug: true, minPrice: true, isOnRequest: true },
      orderBy: [{ salesCount: "desc" }, { viewCount: "desc" }],
      take: 6,
    }),
    loadCategories(),
  ]);
  const phrase = terms.join(" ");
  return {
    products,
    categories: categories.filter((c) => c.isVisible && c.name.toLowerCase().includes(phrase)).slice(0, 3).map((c) => ({ name: c.name, slug: c.slug })),
  };
}

// ───────────── Product detail ─────────────

export async function getProductBySlug(slug: string) {
  return db.product.findFirst({
    where: { slug, ...PUBLIC_PRODUCT_WHERE },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { where: { isActive: true, deletedAt: null }, orderBy: { sortOrder: "asc" } },
      category: true,
      brand: true,
      tags: { include: { tag: true } },
    },
  });
}

// ───────────── Aggregates ─────────────

export { syncProductAggregates, syncRating } from "./catalog-sync";

/** Visible categories that contain at least one live product (directly or through a subcategory). */
export const navCategories = cache(async () => {
  const { categories } = await loadCategories();
  const counts = await db.product.groupBy({ by: ["categoryId"], where: PUBLIC_PRODUCT_WHERE, _count: true });
  const countOf = new Map(counts.map((c) => [c.categoryId, c._count]));
  const visible = categories.filter((c) => c.isVisible);
  const withTotals = visible.map((c) => ({
    ...c,
    productCount: descendantIds(c.id, visible).reduce((s, id) => s + (countOf.get(id) ?? 0), 0),
  }));
  return withTotals.filter((c) => c.productCount > 0);
});
