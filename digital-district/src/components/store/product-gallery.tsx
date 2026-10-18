"use client";

import { useState } from "react";
import { ProductImage } from "./product-image";
import { cn } from "../ui";

export function videoEmbed(url: string | null | undefined): { kind: "iframe" | "video"; src: string } | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v") ?? (u.pathname.startsWith("/shorts/") ? u.pathname.split("/")[2] : null);
      if (id && /^[\w-]{6,20}$/.test(id)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      if (/^[\w-]{6,20}$/.test(id)) return { kind: "iframe", src: `https://www.youtube-nocookie.com/embed/${id}` };
    }
    if (host === "vimeo.com" && /^\/\d+$/.test(u.pathname)) return { kind: "iframe", src: `https://player.vimeo.com/video${u.pathname}` };
    if (u.protocol === "https:" && /\.(mp4|webm)$/i.test(u.pathname)) return { kind: "video", src: url };
  } catch {
    return null;
  }
  return null;
}

export function ProductGallery({ images, title, videoUrl }: { images: { key: string; alt: string | null }[]; title: string; videoUrl: string | null }) {
  const video = videoEmbed(videoUrl);
  const slides: ({ type: "image"; key: string; alt: string } | { type: "video" })[] = [
    ...images.map((i) => ({ type: "image" as const, key: i.key, alt: i.alt || title })),
    ...(video ? [{ type: "video" as const }] : []),
  ];
  const [active, setActive] = useState(0);
  const current = slides[active];
  return (
    <div className="space-y-3">
      <div className="relative aspect-square overflow-hidden rounded-3xl border border-line bg-surface sm:aspect-[4/3] lg:aspect-square">
        {!current ? (
          <ProductImage imageKey={null} alt={title} title={title} />
        ) : current.type === "image" ? (
          <ProductImage imageKey={current.key} alt={current.alt} title={title} priority sizes="(min-width: 1024px) 50vw, 100vw" />
        ) : video!.kind === "iframe" ? (
          <iframe src={video!.src} title={`${title} video`} className="size-full" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen loading="lazy" />
        ) : (
          <video src={video!.src} controls className="size-full bg-black object-contain" preload="metadata" />
        )}
      </div>
      {slides.length > 1 && (
        <div className="scrollbar-none flex gap-2 overflow-x-auto">
          {slides.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={s.type === "video" ? "Show video" : `Show image ${i + 1}`}
              aria-current={i === active}
              className={cn("relative size-20 shrink-0 overflow-hidden rounded-xl border-2 transition", i === active ? "border-brand-400" : "border-transparent opacity-70 hover:opacity-100")}
            >
              {s.type === "image" ? <ProductImage imageKey={s.key} alt="" title={title} sizes="80px" /> : <span className="grid size-full place-items-center bg-surface-2 text-xs font-semibold">▶ Video</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
