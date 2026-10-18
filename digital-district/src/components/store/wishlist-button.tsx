import { Heart } from "lucide-react";
import { toggleWishlistAction } from "@/app/actions/engagement";
import { cn } from "../ui";

export function WishlistButton({ productId, active, returnTo }: { productId: string; active: boolean; returnTo: string }) {
  return (
    <form action={toggleWishlistAction}>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      <button
        type="submit"
        aria-pressed={active}
        className={cn("inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition", active ? "border-brand-400 bg-brand-500/15 text-brand-100" : "border-line-strong text-muted hover:border-brand-400 hover:text-white")}
      >
        <Heart className={cn("size-4", active && "fill-brand-300 text-brand-300")} />
        {active ? "In wishlist" : "Add to wishlist"}
      </button>
    </form>
  );
}
