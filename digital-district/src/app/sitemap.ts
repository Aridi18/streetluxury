export const dynamic = "force-dynamic";

import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [products, categories, pages] = await Promise.all([
    db.product.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { slug: true, updatedAt: true } }),
    db.category.findMany({ where: { isVisible: true, deletedAt: null }, select: { slug: true, updatedAt: true } }),
    db.page.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true } }),
  ]);
  const base = env.appUrl;
  return [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/offers`, changeFrequency: "daily", priority: 0.8 },
    { url: `${base}/faq`, priority: 0.5 },
    { url: `${base}/contact`, priority: 0.5 },
    ...categories.map((c) => ({ url: `${base}/category/${c.slug}`, lastModified: c.updatedAt, priority: 0.8 })),
    ...products.map((p) => ({ url: `${base}/product/${p.slug}`, lastModified: p.updatedAt, priority: 0.7 })),
    ...pages.map((p) => ({ url: `${base}/${p.slug}`, lastModified: p.updatedAt, priority: 0.3 })),
  ];
}
