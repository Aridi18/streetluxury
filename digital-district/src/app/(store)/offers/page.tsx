import type { Metadata } from "next";
import { Listing, type RawSearchParams } from "@/components/store/listing";

export const metadata: Metadata = { title: "Offers", description: "Current discounts and limited-time offers." };

export default async function OffersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  return <Listing title="Offers" subtitle="Products currently discounted. Prices update automatically when an offer ends." eyebrow="Limited time" basePath="/offers" searchParams={await searchParams} fixed={{ onSale: true }} />;
}
