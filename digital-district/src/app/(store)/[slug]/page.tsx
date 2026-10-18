import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { db } from "@/lib/db";
import { Markdown } from "@/components/markdown";

// Owner-managed content pages (About, Terms, Privacy…). Also keeps old storefront links such as /netflix working
// by permanently redirecting them to the product's new address.
async function load(slug: string) {
  if (!/^[a-z0-9-]{1,100}$/.test(slug)) return null;
  return db.page.findFirst({ where: { slug, isPublished: true } });
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const page = await load((await params).slug);
  return page ? { title: page.seoTitle || page.title, description: page.seoDescription ?? undefined, alternates: { canonical: `/${page.slug}` } } : {};
}

export default async function ContentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const page = await load(slug);
  if (!page) {
    const product = /^[a-z0-9-]{1,120}$/.test(slug) ? await db.product.findFirst({ where: { slug, status: "ACTIVE", deletedAt: null }, select: { slug: true } }) : null;
    if (product) permanentRedirect(`/product/${product.slug}`);
    notFound();
  }
  return (
    <article className="container-page max-w-3xl py-14">
      <h1 className="mb-2 text-3xl font-bold sm:text-4xl">{page.title}</h1>
      <p className="mb-10 text-sm text-subtle">Last updated {page.updatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      <Markdown source={page.body} />
    </article>
  );
}
