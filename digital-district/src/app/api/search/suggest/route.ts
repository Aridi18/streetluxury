import { NextResponse } from "next/server";
import { searchSuggestions } from "@/lib/catalog";

export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 80);
  const data = await searchSuggestions(q);
  return NextResponse.json(data, { headers: { "Cache-Control": "public, max-age=30" } });
}
