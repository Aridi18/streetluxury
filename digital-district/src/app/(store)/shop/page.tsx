import type { Metadata } from "next";
import { Listing, type RawSearchParams } from "@/components/store/listing";

export async function generateMetadata({ searchParams }: { searchParams: Promise<RawSearchParams> }): Promise<Metadata> {
  const q = (await searchParams).q;
  return { title: q ? `Search: ${q}` : "Shop all products", robots: q ? { index: false } : undefined, alternates: { canonical: "/shop" } };
}

export default async function ShopPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : undefined;
  return <Listing title={q ? `Results for “${q}”` : "All products"} eyebrow={q ? "Search" : "Shop"} basePath="/shop" searchParams={sp} />;
}
