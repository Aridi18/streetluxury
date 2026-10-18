import { imageSrcSet, imageUrl } from "@/lib/media";
import { cn } from "../ui";

/** Product photo with responsive sizes; products without photos get a clean typographic tile (never a fake image). */
export function ProductImage({ imageKey, alt, title, className, sizes = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw", priority }: { imageKey: string | null; alt: string; title: string; className?: string; sizes?: string; priority?: boolean }) {
  if (imageKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={imageUrl(imageKey, 800)!}
        srcSet={imageSrcSet(imageKey)}
        sizes={sizes}
        alt={alt}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className={cn("size-full object-cover", className)}
      />
    );
  }
  const words = title.replace(/[^\p{L}\p{N}\s+]/gu, " ").split(/\s+/).filter(Boolean);
  const mono = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
  return (
    <div className={cn("relative grid size-full place-items-center overflow-hidden bg-[radial-gradient(120%_90%_at_20%_0%,rgb(139_92_246/0.28),transparent_55%),linear-gradient(160deg,#1a1824,#0e0d13)]", className)} role="img" aria-label={alt}>
      <div className="bg-grid absolute inset-0 opacity-40" />
      <div className="relative flex flex-col items-center gap-2 px-4 text-center">
        <span className="font-display text-4xl font-bold tracking-tight text-white/90 sm:text-5xl">{mono}</span>
        <span className="line-clamp-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-200/80">{title}</span>
      </div>
    </div>
  );
}
