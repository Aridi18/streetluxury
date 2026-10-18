import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Clock, PackageCheck, ShieldCheck, Star, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { getProductBySlug, loadCategories, loadPromoRules, productCards } from "@/lib/catalog";
import { categoryLineage, salePrice } from "@/lib/pricing";
import { getSettings } from "@/lib/settings";
import { getCurrentUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { parseCustomFieldDefs, availableQuantity } from "@/lib/cart";
import { imageUrl } from "@/lib/media";
import { ProductGallery } from "@/components/store/product-gallery";
import { ProductPurchase, type PurchaseVariant } from "@/components/store/product-purchase";
import { ShareButtons } from "@/components/store/share-buttons";
import { WishlistButton } from "@/components/store/wishlist-button";
import { ProductGrid } from "@/components/store/product-card";
import { RecentlyViewed, TrackView } from "@/components/store/recently-viewed";
import { Markdown } from "@/components/markdown";
import { Badge, buttonClass } from "@/components/ui";
import { WhatsAppIcon } from "@/components/store/icons";
import { waLink } from "@/lib/whatsapp";

const TYPE_LABEL = { PHYSICAL: "Physical product", DIGITAL: "Digital product", SUBSCRIPTION: "Subscription", LICENSE: "Licence", SERVICE: "Service" } as const;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await getProductBySlug((await params).slug);
  if (!p) return {};
  const img = p.images[0] ? imageUrl(p.images[0].key, 1600) : null;
  return {
    title: p.seoTitle || p.title,
    description: p.seoDescription || p.shortDescription || undefined,
    alternates: { canonical: `/product/${p.slug}` },
    openGraph: { title: p.title, description: p.shortDescription ?? undefined, ...(img ? { images: [img] } : {}) },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) notFound();
  const [settings, promos, { parentOf }, user] = await Promise.all([getSettings(), loadPromoRules(), loadCategories(), getCurrentUser()]);
  // View counter for "most popular" sorting (no personal data).
  await db.product.update({ where: { id: product.id }, data: { viewCount: { increment: 1 } } });

  const now = new Date();
  const categoryIds = categoryLineage(product.categoryId, parentOf);
  const variants: PurchaseVariant[] = product.variants.map((v) => {
    const { unitPrice, promo } = salePrice({ productId: product.id, categoryIds, basePrice: v.price }, promos, now);
    const was = v.compareAtPrice && v.compareAtPrice > unitPrice ? v.compareAtPrice : unitPrice < v.price ? v.price : null;
    const opts = (v.optionValues && typeof v.optionValues === "object" && !Array.isArray(v.optionValues) ? v.optionValues : {}) as Record<string, string>;
    return {
      id: v.id,
      name: v.name,
      optionValues: product.variants.length > 1 && Object.keys(opts).length === 0 ? { Option: v.name } : opts,
      price: unitPrice,
      was,
      available: availableQuantity(v),
      tracked: v.trackInventory && !v.allowBackorder,
      durationDays: v.durationDays,
      saleEndsAt: promo?.endsAt?.toISOString() ?? null,
    };
  });
  const [reviews, related, wished, reviewable] = await Promise.all([
    db.review.findMany({ where: { productId: product.id, status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 20 }),
    productCards({ id: { not: product.id }, OR: [{ categoryId: product.categoryId ?? undefined }, { brandId: product.brandId ?? undefined }] }, [{ salesCount: "desc" }, { sortOrder: "asc" }], 4),
    user ? db.wishlistItem.findUnique({ where: { userId_productId: { userId: user.id, productId: product.id } } }) : null,
    user ? db.orderItem.findFirst({ where: { productId: product.id, order: { userId: user.id, status: { in: ["DELIVERED", "COMPLETED"] } }, reviews: { none: {} } } }) : null,
  ]);
  const url = `${env.appUrl}/product/${product.slug}`;
  const specs = (Array.isArray(product.specifications) ? product.specifications : []) as { label?: string; value?: string }[];
  const inStock = variants.some((v) => v.available > 0);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description: product.shortDescription ?? product.description ?? undefined,
    sku: product.variants[0]?.sku,
    brand: product.brand ? { "@type": "Brand", name: product.brand.name } : undefined,
    image: product.images.map((i) => `${env.appUrl}${imageUrl(i.key, 1600)}`),
    ...(variants.length && !product.isOnRequest
      ? { offers: { "@type": "AggregateOffer", priceCurrency: settings.currency, lowPrice: (Math.min(...variants.map((v) => v.price)) / 100).toFixed(2), highPrice: (Math.max(...variants.map((v) => v.price)) / 100).toFixed(2), offerCount: variants.length, availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" } }
      : {}),
    ...(product.ratingCount > 0 ? { aggregateRating: { "@type": "AggregateRating", ratingValue: product.ratingAvg.toFixed(1), reviewCount: product.ratingCount } } : {}),
  };

  return (
    <div className="container-page py-8">
      <TrackView slug={product.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <nav aria-label="Breadcrumb" className="mb-6 text-xs text-subtle">
        <Link href="/" className="hover:text-white">Home</Link>
        {product.category && (<><span className="mx-1.5">/</span><Link href={`/category/${product.category.slug}`} className="hover:text-white">{product.category.name}</Link></>)}
        <span className="mx-1.5">/</span><span className="text-muted">{product.title}</span>
      </nav>

      <div className="grid gap-10 lg:grid-cols-2 lg:gap-14">
        <div className="lg:sticky lg:top-36 lg:self-start">
          <ProductGallery images={product.images.map((i) => ({ key: i.key, alt: i.alt }))} title={product.title} videoUrl={product.videoUrl} />
        </div>
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {product.badge && <Badge tone="accent">{product.badge}</Badge>}
            <Badge>{TYPE_LABEL[product.type]}</Badge>
            {product.brand && <Link href={`/brand/${product.brand.slug}`}><Badge>{product.brand.name}</Badge></Link>}
          </div>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{product.title}</h1>
          {product.shortDescription && <p className="mt-3 text-lg text-muted">{product.shortDescription}</p>}
          {product.ratingCount > 0 && (
            <a href="#reviews" className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted hover:text-white">
              <Star className="size-4 fill-warning text-warning" /> <span className="font-semibold text-fg">{product.ratingAvg.toFixed(1)}</span> · {product.ratingCount} verified review{product.ratingCount === 1 ? "" : "s"}
            </a>
          )}
          <div className="mt-6 border-t border-line pt-6">
            {product.isOnRequest || variants.length === 0 ? (
              <div className="space-y-4">
                <p className="font-display text-3xl font-bold text-brand-200">Available on request</p>
                <p className="text-muted">Prices for this service depend on your exact needs or change often. Message us and we&apos;ll send you a quote within minutes.</p>
                <a href={waLink(settings.whatsappNumber, `Hello Digital District, I'd like a quote for ${product.title}.\n${url}`)} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "lg", "w-full")}>
                  <WhatsAppIcon className="size-5" /> Request a quote on WhatsApp
                </a>
              </div>
            ) : (
              <ProductPurchase
                productTitle={product.title}
                productUrl={url}
                variants={variants}
                customFields={parseCustomFieldDefs(product.customFields)}
                allowNote={product.allowCustomerNote}
                whatsappNumber={settings.whatsappNumber}
                currency={settings.currency}
              />
            )}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <WishlistButton productId={product.id} active={Boolean(wished)} returnTo={`/product/${product.slug}`} />
            <ShareButtons url={url} title={product.title} />
          </div>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2">
            {product.deliveryMethod && <Info icon={product.type === "PHYSICAL" ? <Truck className="size-5" /> : <PackageCheck className="size-5" />} title="Delivery" text={product.deliveryMethod} />}
            {product.deliveryEstimate && <Info icon={<Clock className="size-5" />} title="Estimated time" text={product.deliveryEstimate} />}
            {product.warranty && <Info icon={<ShieldCheck className="size-5" />} title="Warranty" text={product.warranty} />}
            {variants.some((v) => v.durationDays) && <Info icon={<BadgeCheck className="size-5" />} title="Duration" text="Your plan runs for the duration shown on the option you choose. We remind you before it ends." />}
          </ul>
        </div>
      </div>

      <div className="mt-16 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-10">
          {product.description && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">About this product</h2>
              <Markdown source={product.description} />
            </section>
          )}
          {specs.length > 0 && (
            <section>
              <h2 className="mb-4 text-xl font-semibold">Specifications</h2>
              <dl className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
                {specs.filter((s) => s.label).map((s, i) => (
                  <div key={i} className="grid grid-cols-[minmax(120px,1fr)_2fr] gap-4 bg-surface px-4 py-3 text-sm">
                    <dt className="text-muted">{s.label}</dt>
                    <dd className="text-fg">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
        <div className="space-y-3">
          {product.deliveryInstructions && <Policy title="How delivery works" body={product.deliveryInstructions} open />}
          {product.returnPolicy ? <Policy title="Returns" body={product.returnPolicy} /> : <Policy title="Returns & refunds" body="See our [refund & warranty policy](/refund-policy)." />}
          {product.terms && <Policy title="Terms" body={product.terms} />}
        </div>
      </div>

      <section id="reviews" className="mt-16 scroll-mt-40">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Customer reviews</h2>
            <p className="text-sm text-muted">Only customers who received this product can leave a review.</p>
          </div>
          {reviewable && <Link href={`/account/orders?review=${reviewable.id}`} className={buttonClass("secondary", "sm")}>Write a review</Link>}
        </div>
        {reviews.length === 0 ? (
          <p className="card p-6 text-sm text-muted">No reviews yet.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {reviews.map((r) => (
              <li key={r.id} className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex gap-0.5" aria-label={`${r.rating} out of 5`}>
                    {Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < r.rating ? "size-4 fill-warning text-warning" : "size-4 text-line-strong"} aria-hidden />)}
                  </div>
                  <span className="text-xs text-subtle">{r.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                </div>
                {r.title && <p className="mt-2 font-semibold text-white">{r.title}</p>}
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{r.body}</p>
                <p className="mt-3 flex items-center gap-1 text-xs text-subtle"><BadgeCheck className="size-3.5 text-success" /> {r.authorName} · Verified purchase</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-5 text-xl font-semibold">You may also like</h2>
          <ProductGrid products={related} whatsappNumber={settings.whatsappNumber} />
        </section>
      )}
      <RecentlyViewed exclude={product.slug} />
    </div>
  );
}

function Info({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <li className="flex gap-3 rounded-2xl border border-line bg-surface p-4">
      <span className="text-brand-300">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
    </li>
  );
}

function Policy({ title, body, open }: { title: string; body: string; open?: boolean }) {
  return (
    <details className="card group p-5" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-white">
        {title}
        <span className="text-subtle transition group-open:rotate-45">+</span>
      </summary>
      <div className="mt-3"><Markdown source={body} /></div>
    </details>
  );
}
