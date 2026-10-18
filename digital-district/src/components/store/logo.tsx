import Link from "next/link";
import { publicFileUrl } from "@/lib/media";
import { cn } from "../ui";

/**
 * The store logo. When the owner uploads the original logo in Admin → Settings, it is shown exactly as uploaded
 * (no recolouring, cropping or distortion — only scaled proportionally). Until then a plain typographic wordmark is shown.
 */
export function Logo({ logoKey, storeName, className, size = "md" }: { logoKey: string | null; storeName: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const height = size === "sm" ? "h-8" : size === "lg" ? "h-14" : "h-10";
  const url = publicFileUrl(logoKey);
  return (
    <Link href="/" className={cn("inline-flex shrink-0 items-center gap-2.5", className)} aria-label={`${storeName} home`}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={storeName} className={cn(height, "w-auto object-contain")} />
      ) : (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-bold tracking-[0.22em] text-white">DIGITAL</span>
          <span className="font-display text-[15px] font-bold tracking-[0.22em] text-brand-300">DISTRICT</span>
        </span>
      )}
    </Link>
  );
}
