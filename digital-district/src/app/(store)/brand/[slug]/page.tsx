import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { Listing, type RawSearchParams } from "@/components/store/listing";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const b = await db.brand.findUnique({ where: { slug: (await params).slug } });
  return b ? { title: b.name } : {};
}

export default async function BrandPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<RawSearchParams> }) {
  const { slug } = await params;
  const brand = await db.brand.findUnique({ where: { slug } });
  if (!brand || !brand.isVisible) notFound();
  return <Listing title={brand.name} eyebrow="Brand" basePath={`/brand/${slug}`} searchParams={await searchParams} fixed={{ brandSlug: slug }} />;
}
