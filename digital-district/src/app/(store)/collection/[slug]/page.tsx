import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { productCards } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { ProductGrid } from "@/components/store/product-card";
import { EmptyState } from "@/components/ui";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await db.collection.findUnique({ where: { slug: (await params).slug } });
  return c ? { title: c.name, description: c.description ?? undefined } : {};
}

export default async function CollectionPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const collection = await db.collection.findUnique({ where: { slug }, include: { products: { orderBy: { sortOrder: "asc" } } } });
  if (!collection || !collection.isVisible) notFound();
  const ids = collection.products.map((p) => p.productId);
  const [cards, s] = await Promise.all([productCards({ id: { in: ids } }, [], 200), getSettings()]);
  cards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  return (
    <div className="container-page py-10">
      <p className="eyebrow mb-2">Collection</p>
      <h1 className="text-3xl font-bold text-white sm:text-4xl">{collection.name}</h1>
      {collection.description && <p className="mt-2 max-w-2xl text-muted">{collection.description}</p>}
      <div className="mt-8">{cards.length ? <ProductGrid products={cards} whatsappNumber={s.whatsappNumber} /> : <EmptyState title="Nothing here yet" />}</div>
    </div>
  );
}
