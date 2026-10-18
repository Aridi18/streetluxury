import { NextResponse } from "next/server";
import { productCards } from "@/lib/catalog";
import { formatMoney } from "@/lib/money";

export async function GET(request: Request) {
  const slugs = (new URL(request.url).searchParams.get("slugs") ?? "").split(",").map((s) => s.trim()).filter((s) => /^[a-z0-9-]{1,120}$/.test(s)).slice(0, 12);
  if (!slugs.length) return NextResponse.json([]);
  const cards = await productCards({ slug: { in: slugs } }, [], 12);
  return NextResponse.json(
    cards.map((c) => ({ slug: c.slug, title: c.title, imageKey: c.imageKey, priceLabel: c.priceFrom == null ? "On request" : `${c.multiplePrices ? "From " : ""}${formatMoney(c.priceFrom)}` })),
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
