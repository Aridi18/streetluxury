import Link from "next/link";
import { ArrowRight, Star } from "lucide-react";
import { db } from "@/lib/db";
import { getSettings, type HomeSectionKey } from "@/lib/settings";
import { navCategories, onSaleWhere, productCards, loadPromoRules } from "@/lib/catalog";
import { isPromoLive } from "@/lib/pricing";
import { imageSrcSet, imageUrl } from "@/lib/media";
import { waLink } from "@/lib/whatsapp";
import { ProductGrid } from "@/components/store/product-card";
import { SearchBox } from "@/components/store/search-box";
import { CategoryIcon, BenefitIcon, WhatsAppIcon } from "@/components/store/icons";
import { NewsletterForm } from "@/components/store/newsletter-form";
import { RecentlyViewed } from "@/components/store/recently-viewed";
import { Countdown } from "@/components/store/countdown";
import { LinkButton, SectionHeading, buttonClass } from "@/components/ui";
import { NEWSLETTER_CONSENT } from "@/lib/consent";

export default async function HomePage() {
  const s = await getSettings();
  const enabled = s.homeSections.filter((x) => x.enabled).map((x) => x.key);
  const sections: Record<HomeSectionKey, () => Promise<React.ReactNode>> = {
    hero: () => Hero(),
    categories: () => Categories(),
    offers: () => Offers(s.whatsappNumber),
    featured: async () => Row("Featured", "Hand-picked by our team", await productCards({ isFeatured: true }, [{ sortOrder: "asc" }], 8), s.whatsappNumber, "/shop"),
    bestsellers: async () =>
      Row("Bestsellers", "What our customers order most", await productCards({ OR: [{ isBestseller: true }, { salesCount: { gt: 0 } }] }, [{ salesCount: "desc" }, { isBestseller: "desc" }, { sortOrder: "asc" }], 8), s.whatsappNumber, "/shop?sort=bestsellers"),
    newArrivals: async () => Row("New arrivals", "Recently added to the store", await productCards({}, [{ publishedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }], 8), s.whatsappNumber, "/shop?sort=newest"),
    collections: () => Collections(s.whatsappNumber),
    recentlyViewed: async () => <RecentlyViewed />,
    reviews: () => Reviews(),
    howItWorks: async () => HowItWorks(s.howItWorks),
    benefits: async () => Benefits(s.benefits),
    newsletter: async () => Newsletter(),
  };
  const rendered = await Promise.all(enabled.map((k) => sections[k]()));
  return <div className="pb-6">{rendered.map((node, i) => <div key={enabled[i]}>{node}</div>)}</div>;
}

async function Hero() {
  const s = await getSettings();
  const now = new Date();
  const [banners, stats] = await Promise.all([
    db.banner.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gt: now } }] }] },
      orderBy: { sortOrder: "asc" },
      take: 3,
    }),
    Promise.all([db.product.count({ where: { status: "ACTIVE", deletedAt: null } }), navCategories()]),
  ]);
  const [productCount, categories] = stats;
  const banner = banners[0];
  return (
    <section className="relative overflow-hidden border-b border-line">
      <div className="bg-grid absolute inset-0 opacity-60 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]" />
      <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-brand-600/25 blur-[120px]" />
      <div className="container-page relative grid items-center gap-10 py-14 sm:py-20 lg:grid-cols-[1.15fr_0.85fr] lg:py-24">
        <div className="animate-fade-up">
          <p className="eyebrow mb-5">{banner?.eyebrow || s.heroEyebrow || s.tagline}</p>
          <h1 className="text-balance text-4xl font-bold leading-[1.05] text-white sm:text-5xl lg:text-6xl">{banner?.title || s.heroTitle}</h1>
          {(banner?.subtitle || s.heroSubtitle) && <p className="mt-5 max-w-xl text-pretty text-base text-muted sm:text-lg">{banner?.subtitle || s.heroSubtitle}</p>}
          <SearchBox large className="mt-8 hidden max-w-xl md:block" />
          <div className="mt-6 flex flex-wrap gap-3">
            <LinkButton href={banner?.ctaHref || "/shop"} size="lg">
              {banner?.ctaLabel || "Browse the store"} <ArrowRight className="size-4" />
            </LinkButton>
            <a href={waLink(s.whatsappNumber, s.whatsappDefaultMessage)} target="_blank" rel="noopener noreferrer" className={buttonClass("outline", "lg")}>
              <WhatsAppIcon className="size-5 text-[#25D366]" /> Order on WhatsApp
            </a>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-4 border-t border-line pt-6">
            <div><dt className="text-xs text-subtle">Products</dt><dd className="font-display text-2xl font-semibold text-white">{productCount}</dd></div>
            <div><dt className="text-xs text-subtle">Categories</dt><dd className="font-display text-2xl font-semibold text-white">{categories.filter((c) => !c.parentId).length}</dd></div>
            <div><dt className="text-xs text-subtle">Support</dt><dd className="font-display text-sm font-semibold leading-6 text-white">{s.supportHours || "WhatsApp"}</dd></div>
          </dl>
        </div>
        <div className="relative hidden lg:block">
          {banner?.imageKey ? (
            <div className="overflow-hidden rounded-3xl border border-line shadow-[var(--shadow-glow)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl(banner.imageKey, 1600)!} srcSet={imageSrcSet(banner.imageKey)} sizes="40vw" alt={banner.title} className="aspect-[4/5] w-full object-cover" />
            </div>
          ) : (
            <div className="relative rounded-3xl border border-line bg-surface/80 p-6 shadow-[var(--shadow-glow)] backdrop-blur">
              <p className="eyebrow mb-4">{s.tagline}</p>
              <ul className="grid grid-cols-2 gap-3">
                {categories.filter((c) => !c.parentId).slice(0, 8).map((c) => (
                  <li key={c.id}>
                    <Link href={`/category/${c.slug}`} className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-3 text-sm font-medium text-fg/90 transition hover:border-brand-500/50 hover:text-white">
                      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-500/15 text-brand-300"><CategoryIcon name={c.icon} className="size-4" /></span>
                      <span className="line-clamp-2">{c.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

async function Categories() {
  const categories = (await navCategories()).filter((c) => !c.parentId);
  if (!categories.length) return null;
  return (
    <section className="container-page mt-16 sm:mt-20" aria-labelledby="cat-heading">
      <SectionHeading eyebrow="Browse" title="Shop by category" subtitle="Everything from streaming to professional software, organised for you." />
      <ul className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id}>
            <Link href={`/category/${c.slug}`} className="group flex h-full items-start gap-4 rounded-2xl border border-line bg-surface p-4 transition hover:border-brand-500/40 hover:bg-surface-2">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-brand-500/25 bg-brand-500/10 text-brand-300 transition group-hover:bg-brand-500/20"><CategoryIcon name={c.icon} className="size-5" /></span>
              <span className="min-w-0">
                <span className="block font-semibold text-white">{c.name}</span>
                {c.description && <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{c.description}</span>}
                <span className="mt-1.5 block text-xs text-subtle">{c.productCount} product{c.productCount === 1 ? "" : "s"}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Offers(whatsappNumber: string) {
  const now = new Date();
  const promos = (await loadPromoRules()).filter((p) => isPromoLive(p, now));
  const showcase = await db.promotion.findMany({ where: { id: { in: promos.map((p) => p.id) }, showOnHome: true }, orderBy: { endsAt: "asc" } });
  const where = await onSaleWhere();
  const hasSales = promos.some((p) => !p.code && p.type !== "FREE_SHIPPING");
  const products = hasSales || Object.keys(where).length ? await productCards(where, [{ salesCount: "desc" }], 8) : [];
  const onSale = products.filter((p) => p.wasPrice != null);
  if (!onSale.length && !showcase.length) return null;
  return (
    <section className="container-page mt-20" aria-labelledby="offers-heading">
      <SectionHeading eyebrow="Limited time" title="Current offers" action={<Link href="/offers" className="text-sm font-semibold text-brand-300 hover:text-brand-200">All offers →</Link>} />
      {showcase.length > 0 && (
        <div className="mb-6 grid gap-3 md:grid-cols-2">
          {showcase.map((p) => (
            <div key={p.id} className="flex flex-col justify-between gap-3 rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-700/25 to-surface p-5 sm:flex-row sm:items-center">
              <div>
                <p className="font-display text-lg font-semibold text-white">{p.name}</p>
                {p.description && <p className="text-sm text-muted">{p.description}</p>}
                {p.code && <p className="mt-2 text-sm">Use code <span className="rounded-md border border-brand-400/50 bg-brand-500/15 px-2 py-0.5 font-mono font-semibold text-brand-100">{p.code}</span> at checkout</p>}
              </div>
              {p.endsAt && <Countdown endsAt={p.endsAt.toISOString()} className="shrink-0 rounded-full bg-black/40 px-3 py-1.5 font-mono text-xs text-brand-100" />}
            </div>
          ))}
        </div>
      )}
      {onSale.length > 0 && <ProductGrid products={onSale} whatsappNumber={whatsappNumber} />}
    </section>
  );
}

function Row(title: string, subtitle: string, products: Awaited<ReturnType<typeof productCards>>, whatsappNumber: string, href: string) {
  if (!products.length) return null;
  return (
    <section className="container-page mt-20">
      <SectionHeading title={title} subtitle={subtitle} action={<Link href={href} className="text-sm font-semibold text-brand-300 hover:text-brand-200">View all →</Link>} />
      <ProductGrid products={products} whatsappNumber={whatsappNumber} />
    </section>
  );
}

async function Collections(whatsappNumber: string) {
  const collections = await db.collection.findMany({ where: { isVisible: true, showOnHome: true }, orderBy: { sortOrder: "asc" }, include: { products: { orderBy: { sortOrder: "asc" }, select: { productId: true } } } });
  const blocks = await Promise.all(
    collections.map(async (c) => {
      const ids = c.products.map((p) => p.productId);
      const cards = await productCards({ id: { in: ids } }, [], 8);
      cards.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      return Row(c.name, c.description ?? "", cards, whatsappNumber, `/collection/${c.slug}`);
    }),
  );
  return <>{blocks}</>;
}

async function Reviews() {
  const reviews = await db.review.findMany({ where: { status: "APPROVED" }, orderBy: { createdAt: "desc" }, take: 6, include: { product: { select: { title: true, slug: true } } } });
  if (!reviews.length) return null;
  return (
    <section className="container-page mt-20" aria-labelledby="reviews-heading">
      <SectionHeading eyebrow="Verified buyers" title="What customers say" subtitle="Reviews can only be left by customers who completed an order." />
      <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {reviews.map((r) => (
          <li key={r.id} className="card flex flex-col gap-3 p-5">
            <div className="flex gap-0.5" aria-label={`${r.rating} out of 5 stars`}>
              {Array.from({ length: 5 }, (_, i) => <Star key={i} className={i < r.rating ? "size-4 fill-warning text-warning" : "size-4 text-line-strong"} aria-hidden />)}
            </div>
            {r.title && <p className="font-semibold text-white">{r.title}</p>}
            <p className="line-clamp-5 text-sm text-muted">{r.body}</p>
            <p className="mt-auto text-xs text-subtle">{r.authorName} · <Link href={`/product/${r.product.slug}`} className="hover:text-white">{r.product.title}</Link></p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HowItWorks(steps: { title: string; text: string }[]) {
  if (!steps.length) return null;
  return (
    <section className="container-page mt-20">
      <SectionHeading eyebrow="Simple" title="How ordering works" />
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((st, i) => (
          <li key={i} className="card relative overflow-hidden p-6">
            <span className="font-display text-5xl font-bold text-brand-500/25">{String(i + 1).padStart(2, "0")}</span>
            <p className="mt-2 text-lg font-semibold text-white">{st.title}</p>
            <p className="mt-1 text-sm text-muted">{st.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Benefits(benefits: { title: string; text: string; icon: string }[]) {
  if (!benefits.length) return null;
  return (
    <section className="container-page mt-20">
      <ul className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {benefits.map((b) => (
          <li key={b.title} className="flex gap-4 bg-surface p-6">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-500/12 text-brand-300"><BenefitIcon name={b.icon} className="size-5" /></span>
            <div>
              <p className="font-semibold text-white">{b.title}</p>
              <p className="mt-1 text-sm text-muted">{b.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Newsletter() {
  return (
    <section className="container-page mt-20">
      <div className="relative overflow-hidden rounded-3xl border border-brand-500/25 bg-gradient-to-br from-brand-800/40 via-surface to-surface p-8 sm:p-12">
        <div className="absolute -right-24 -top-24 size-72 rounded-full bg-brand-500/20 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="eyebrow mb-3">Newsletter</p>
            <h2 className="text-2xl font-semibold text-white sm:text-3xl">Be first to hear about new offers</h2>
            <p className="mt-2 text-muted">Occasional emails about deals and new products. No spam, unsubscribe any time.</p>
          </div>
          <NewsletterForm consentText={NEWSLETTER_CONSENT} />
        </div>
      </div>
    </section>
  );
}
