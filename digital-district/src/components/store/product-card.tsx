import Link from "next/link";
import { Star } from "lucide-react";
import type { ProductCard as Card } from "@/lib/catalog";
import { ProductImage } from "./product-image";
import { Price } from "./price";
import { QuickAddButton } from "./add-to-cart-button";
import { buttonClass, cn } from "../ui";
import { WhatsAppIcon } from "./icons";
import { waLink } from "@/lib/whatsapp";

export function ProductCard({ product, whatsappNumber, priority }: { product: Card; whatsappNumber: string; priority?: boolean }) {
  const href = `/product/${product.slug}`;
  const badge = product.discountPercent ? `-${product.discountPercent}%` : product.badge;
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-line bg-surface transition duration-300 hover:-translate-y-0.5 hover:border-brand-500/40 hover:shadow-[var(--shadow-glow)]">
      <Link href={href} className="relative block aspect-[4/3] overflow-hidden" tabIndex={-1} aria-hidden>
        <ProductImage imageKey={product.imageKey} alt={product.imageAlt} title={product.title} priority={priority} className="transition duration-500 group-hover:scale-[1.03]" />
        {badge && (
          <span className={cn("absolute left-3 top-3 rounded-full px-2.5 py-1 text-[11px] font-semibold backdrop-blur", product.discountPercent ? "bg-brand-500 text-white" : "border border-white/10 bg-black/50 text-brand-100")}>{badge}</span>
        )}
        {!product.inStock && !product.isOnRequest && <span className="absolute right-3 top-3 rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-semibold text-muted">Sold out</span>}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-subtle">
          {product.categoryName && <span className="truncate">{product.categoryName}</span>}
        </div>
        <h3 className="font-display text-[15px] font-semibold leading-snug text-white">
          <Link href={href} className="after:absolute after:inset-0 focus:outline-none">
            {product.title}
          </Link>
        </h3>
        {product.shortDescription && <p className="line-clamp-2 text-sm text-muted">{product.shortDescription}</p>}
        {product.ratingCount > 0 && (
          <p className="flex items-center gap-1 text-xs text-muted">
            <Star className="size-3.5 fill-warning text-warning" aria-hidden />
            <span className="font-semibold text-fg">{product.ratingAvg.toFixed(1)}</span>
            <span>({product.ratingCount} verified review{product.ratingCount === 1 ? "" : "s"})</span>
          </p>
        )}
        <div className="mt-auto flex items-end justify-between gap-3 pt-2">
          <Price amount={product.priceFrom} was={product.wasPrice} from={product.multiplePrices} size="sm" className="text-base" />
          <div className="relative z-10">
            {product.isOnRequest ? (
              <a href={waLink(whatsappNumber, `Hello Digital District, I'd like a quote for ${product.title}.`)} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "sm")}>
                <WhatsAppIcon className="size-4 text-[#25D366]" /> Ask
              </a>
            ) : product.defaultVariantId && product.inStock ? (
              <QuickAddButton variantId={product.defaultVariantId} />
            ) : (
              <Link href={href} className={buttonClass("outline", "sm")}>
                {product.inStock ? "Options" : "View"}
              </Link>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ProductGrid({ products, whatsappNumber, priorityCount = 0 }: { products: Card[]; whatsappNumber: string; priorityCount?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {products.map((p, i) => (
        <ProductCard key={p.id} product={p} whatsappNumber={whatsappNumber} priority={i < priorityCount} />
      ))}
    </div>
  );
}
