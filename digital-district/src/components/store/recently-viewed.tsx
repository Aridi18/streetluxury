"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ProductImage } from "./product-image";

const KEY = "dd_recent";

export function rememberProduct(slug: string) {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
    localStorage.setItem(KEY, JSON.stringify([slug, ...list.filter((s) => s !== slug)].slice(0, 12)));
  } catch {
    // storage unavailable
  }
}

export function TrackView({ slug }: { slug: string }) {
  useEffect(() => rememberProduct(slug), [slug]);
  return null;
}

type Item = { slug: string; title: string; imageKey: string | null; priceLabel: string };

export function RecentlyViewed({ exclude, title = "Recently viewed" }: { exclude?: string; title?: string }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    let slugs: string[] = [];
    try {
      slugs = (JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]).filter((s) => s !== exclude).slice(0, 8);
    } catch {
      return;
    }
    if (!slugs.length) return;
    fetch(`/api/products/recent?slugs=${encodeURIComponent(slugs.join(","))}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Item[]) => setItems(slugs.map((s) => data.find((d) => d.slug === s)).filter(Boolean) as Item[]))
      .catch(() => undefined);
  }, [exclude]);
  if (!items.length) return null;
  return (
    <section className="container-page mt-20" aria-labelledby="recent-heading">
      <h2 id="recent-heading" className="mb-5 text-xl font-semibold">{title}</h2>
      <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
        {items.map((it) => (
          <Link key={it.slug} href={`/product/${it.slug}`} className="w-40 shrink-0 overflow-hidden rounded-xl border border-line bg-surface transition hover:border-brand-500/40 sm:w-48">
            <div className="aspect-[4/3]"><ProductImage imageKey={it.imageKey} alt={it.title} title={it.title} sizes="200px" /></div>
            <div className="p-3">
              <p className="line-clamp-1 text-sm font-semibold">{it.title}</p>
              <p className="text-xs text-muted">{it.priceLabel}</p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
