import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCategories, navCategories } from "@/lib/catalog";
import { Listing, type RawSearchParams } from "@/components/store/listing";

async function find(slug: string) {
  const { categories } = await loadCategories();
  return categories.find((c) => c.slug === slug && c.isVisible) ?? null;
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const c = await find((await params).slug);
  if (!c) return {};
  return { title: c.seoTitle || c.name, description: c.seoDescription || c.description || undefined, alternates: { canonical: `/category/${c.slug}` } };
}

export default async function CategoryPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const { slug } = await params;
  const category = await find(slug);
  if (!category) notFound();
  const children = (await navCategories()).filter((c) => c.parentId === category.id);
  const parent = category.parentId ? (await loadCategories()).categories.find((c) => c.id === category.parentId) : null;
  return (
    <>
      {(children.length > 0 || parent) && (
        <div className="container-page -mb-6 flex flex-wrap gap-2 pt-8">
          {parent && <Link href={`/category/${parent.slug}`} className="rounded-full border border-line-strong px-3 py-1.5 text-sm text-muted hover:text-white">← {parent.name}</Link>}
          {children.map((c) => (
            <Link key={c.id} href={`/category/${c.slug}`} className="rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1.5 text-sm text-brand-100 hover:border-brand-400">{c.name}</Link>
          ))}
        </div>
      )}
      <Listing title={category.name} subtitle={category.description} eyebrow="Category" basePath={`/category/${slug}`} searchParams={await searchParams} fixed={{ categorySlug: slug }} />
    </>
  );
}
