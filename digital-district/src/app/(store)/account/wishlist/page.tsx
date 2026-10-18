import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { productCards } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { ProductGrid } from "@/components/store/product-card";
import { EmptyState, LinkButton } from "@/components/ui";
import { toggleWishlistAction } from "@/app/actions/engagement";

export const metadata: Metadata = { title: "Wishlist" };

export default async function WishlistPage() {
  const user = await requireUser("/account/wishlist");
  const items = await db.wishlistItem.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" } });
  const ids = items.map((i) => i.productId);
  const [cards, s] = await Promise.all([productCards({ id: { in: ids } }, [], 200), getSettings()]);
  cards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
  if (!cards.length) return <EmptyState title="Your wishlist is empty" action={<LinkButton href="/shop">Discover products</LinkButton>}>Tap “Add to wishlist” on any product to save it here.</EmptyState>;
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Wishlist</h2>
      <ProductGrid products={cards} whatsappNumber={s.whatsappNumber} />
      <div className="flex flex-wrap gap-2 pt-2 text-xs text-subtle">
        Remove:
        {cards.map((c) => (
          <form key={c.id} action={toggleWishlistAction}>
            <input type="hidden" name="productId" value={c.id} />
            <input type="hidden" name="returnTo" value="/account/wishlist" />
            <button className="rounded-full border border-line-strong px-2 py-0.5 hover:border-danger hover:text-danger">{c.title} ×</button>
          </form>
        ))}
      </div>
    </div>
  );
}
