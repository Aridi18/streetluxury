import Link from "next/link";
import type { ProductType } from "@prisma/client";
import { SlidersHorizontal, X } from "lucide-react";
import { db } from "@/lib/db";
import { navCategories, productCards, searchProducts, type SearchParams, type SortKey } from "@/lib/catalog";
import { getSettings } from "@/lib/settings";
import { parseMoney } from "@/lib/money";
import { ProductGrid } from "./product-card";
import { AutoSubmitSelect } from "./auto-submit-select";
import { Button, Checkbox, EmptyState, Input, LinkButton, cn } from "../ui";

export type RawSearchParams = Record<string, string | string[] | undefined>;

const TYPES: { value: ProductType; label: string }[] = [
  { value: "SUBSCRIPTION", label: "Subscriptions" },
  { value: "LICENSE", label: "Licences & keys" },
  { value: "DIGITAL", label: "Digital products" },
  { value: "SERVICE", label: "Services" },
  { value: "PHYSICAL", label: "Physical products" },
];

const SORTS: { value: SortKey; label: string }[] = [
  { value: "relevance", label: "Best match" },
  { value: "popular", label: "Most popular" },
  { value: "bestsellers", label: "Bestsellers" },
  { value: "newest", label: "Newest" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export function parseListingParams(sp: RawSearchParams): SearchParams & { minRaw: string; maxRaw: string } {
  const q = one(sp.q)?.slice(0, 100) ?? "";
  const sort = SORTS.some((s) => s.value === one(sp.sort)) ? (one(sp.sort) as SortKey) : undefined;
  const type = TYPES.some((t) => t.value === one(sp.type)) ? (one(sp.type) as ProductType) : undefined;
  const minRaw = one(sp.min) ?? "";
  const maxRaw = one(sp.max) ?? "";
  return {
    q: q || undefined,
    sort,
    type,
    brandSlug: one(sp.brand) || undefined,
    minPrice: parseMoney(minRaw) ?? undefined,
    maxPrice: parseMoney(maxRaw) ?? undefined,
    inStock: one(sp.stock) === "1" || undefined,
    onSale: one(sp.sale) === "1" || undefined,
    page: Math.max(1, Math.min(500, Number(one(sp.page)) || 1)),
    minRaw,
    maxRaw,
  };
}

export async function Listing({ title, subtitle, eyebrow, basePath, searchParams, fixed = {} }: { title: string; subtitle?: string | null; eyebrow?: string; basePath: string; searchParams: RawSearchParams; fixed?: Partial<SearchParams> }) {
  const params = { ...parseListingParams(searchParams), ...fixed };
  const [result, categories, brands, settings] = await Promise.all([
    searchProducts(params),
    navCategories(),
    db.brand.findMany({ where: { isVisible: true, products: { some: { status: "ACTIVE", deletedAt: null } } }, orderBy: { name: "asc" }, select: { name: true, slug: true } }),
    getSettings(),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const keep = (overrides: Record<string, string | undefined>) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
      const val = one(v);
      if (val && !(k in overrides)) qs.set(k, val);
    }
    for (const [k, v] of Object.entries(overrides)) if (v) qs.set(k, v);
    const s = qs.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const chips: { label: string; href: string }[] = [];
  if (params.q && !fixed.q) chips.push({ label: `“${params.q}”`, href: keep({ q: undefined, page: undefined }) });
  if (params.type && !fixed.type) chips.push({ label: TYPES.find((t) => t.value === params.type)!.label, href: keep({ type: undefined, page: undefined }) });
  if (params.brandSlug && !fixed.brandSlug) chips.push({ label: brands.find((b) => b.slug === params.brandSlug)?.name ?? params.brandSlug, href: keep({ brand: undefined, page: undefined }) });
  if (params.minRaw) chips.push({ label: `From $${params.minRaw}`, href: keep({ min: undefined, page: undefined }) });
  if (params.maxRaw) chips.push({ label: `Up to $${params.maxRaw}`, href: keep({ max: undefined, page: undefined }) });
  if (params.inStock) chips.push({ label: "In stock", href: keep({ stock: undefined, page: undefined }) });
  if (params.onSale && !fixed.onSale) chips.push({ label: "On sale", href: keep({ sale: undefined, page: undefined }) });

  const topCats = categories.filter((c) => !c.parentId);
  const filters = (
    <form method="get" action={basePath} className="space-y-6">
      {params.q && !fixed.q && <input type="hidden" name="q" value={params.q} />}
      {params.sort && <input type="hidden" name="sort" value={params.sort} />}
      {!fixed.categorySlug && (
        <div>
          <p className="mb-2 text-sm font-semibold text-white">Category</p>
          <ul className="space-y-0.5 text-sm">
            {topCats.map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.slug}${params.q ? `?q=${encodeURIComponent(params.q)}` : ""}`} className="flex justify-between rounded-lg px-2 py-1.5 text-muted hover:bg-surface-2 hover:text-white">
                  <span>{c.name}</span>
                  <span className="text-xs text-subtle">{c.productCount}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <fieldset>
        <legend className="mb-2 text-sm font-semibold text-white">Price (USD)</legend>
        <div className="flex items-center gap-2">
          <Input name="min" inputMode="decimal" placeholder="Min" defaultValue={params.minRaw} aria-label="Minimum price" className="h-10" />
          <span className="text-subtle">–</span>
          <Input name="max" inputMode="decimal" placeholder="Max" defaultValue={params.maxRaw} aria-label="Maximum price" className="h-10" />
        </div>
      </fieldset>
      {!fixed.type && (
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-white">Product type</legend>
          <div className="space-y-1.5">
            <label className="flex items-center gap-2.5 text-sm text-muted"><input type="radio" name="type" value="" defaultChecked={!params.type} className="accent-brand-500" /> All types</label>
            {TYPES.map((t) => (
              <label key={t.value} className="flex items-center gap-2.5 text-sm text-muted"><input type="radio" name="type" value={t.value} defaultChecked={params.type === t.value} className="accent-brand-500" /> {t.label}</label>
            ))}
          </div>
        </fieldset>
      )}
      {brands.length > 0 && !fixed.brandSlug && (
        <div>
          <label htmlFor="brand-filter" className="mb-2 block text-sm font-semibold text-white">Brand</label>
          <select id="brand-filter" name="brand" defaultValue={params.brandSlug ?? ""} className="h-10 w-full rounded-xl border border-line-strong bg-surface-2 px-3 text-sm">
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-2">
        <Checkbox name="stock" value="1" defaultChecked={params.inStock} label="In stock only" />
        {!fixed.onSale && <Checkbox name="sale" value="1" defaultChecked={params.onSale} label="On sale" />}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="flex-1">Apply filters</Button>
        <LinkButton href={basePath} variant="ghost" size="sm">Reset</LinkButton>
      </div>
    </form>
  );

  const empty = result.items.length === 0;
  const suggestions = empty ? await productCards({ OR: [{ isBestseller: true }, { isFeatured: true }] }, [{ salesCount: "desc" }, { sortOrder: "asc" }], 4) : [];

  return (
    <div className="container-page py-10">
      <nav aria-label="Breadcrumb" className="mb-4 text-xs text-subtle">
        <Link href="/" className="hover:text-white">Home</Link> <span className="mx-1">/</span> <span className="text-muted">{title}</span>
      </nav>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
          <h1 className="text-3xl font-bold text-white sm:text-4xl">{title}</h1>
          {subtitle && <p className="mt-2 max-w-2xl text-muted">{subtitle}</p>}
        </div>
        <form method="get" action={basePath} className="flex items-center gap-2">
          {Object.entries(searchParams).filter(([k]) => k !== "sort" && k !== "page").map(([k, v]) => (one(v) ? <input key={k} type="hidden" name={k} value={one(v)} /> : null))}
          <label htmlFor="sort" className="text-sm text-muted">Sort</label>
          <AutoSubmitSelect id="sort" name="sort" defaultValue={params.sort ?? (params.q ? "relevance" : "popular")} className="h-10 w-48 text-sm">
            {SORTS.filter((s) => s.value !== "relevance" || params.q).map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </AutoSubmitSelect>
          <noscript><Button type="submit" size="sm" variant="secondary">Sort</Button></noscript>
        </form>
      </div>
      <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
        <aside className="lg:sticky lg:top-36 lg:self-start">
          <details className="card group p-4 lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
              <span className="flex items-center gap-2"><SlidersHorizontal className="size-4" /> Filters</span>
              <span className="text-xs text-subtle group-open:hidden">Show</span>
            </summary>
            <div className="mt-4">{filters}</div>
          </details>
          <div className="hidden lg:block">{filters}</div>
        </aside>
        <div>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted">
            <span>{result.total} product{result.total === 1 ? "" : "s"}</span>
            {chips.map((c) => (
              <Link key={c.label} href={c.href} className="inline-flex items-center gap-1 rounded-full border border-line-strong bg-surface-2 px-2.5 py-1 text-xs text-fg hover:border-brand-400">
                {c.label} <X className="size-3" aria-label="Remove filter" />
              </Link>
            ))}
          </div>
          {empty ? (
            <div className="space-y-10">
              <EmptyState
                title={params.q ? `No results for “${params.q}”` : "No products match these filters"}
                action={<div className="flex flex-wrap justify-center gap-2"><LinkButton href={basePath} variant="secondary" size="sm">Clear filters</LinkButton><LinkButton href="/shop" size="sm">Browse everything</LinkButton></div>}
              >
                Try a shorter search, check the spelling, or browse a category. Can&apos;t find it? Message us on WhatsApp — many more services are available on request.
              </EmptyState>
              {topCats.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {topCats.map((c) => <Link key={c.id} href={`/category/${c.slug}`} className="rounded-full border border-line-strong px-3 py-1.5 text-sm text-muted hover:border-brand-400 hover:text-white">{c.name}</Link>)}
                </div>
              )}
              {suggestions.length > 0 && (
                <div>
                  <h2 className="mb-4 text-lg font-semibold">Popular right now</h2>
                  <ProductGrid products={suggestions} whatsappNumber={settings.whatsappNumber} />
                </div>
              )}
            </div>
          ) : (
            <>
              <ProductGrid products={result.items} whatsappNumber={settings.whatsappNumber} priorityCount={4} />
              {totalPages > 1 && (
                <nav className="mt-10 flex items-center justify-center gap-1" aria-label="Pagination">
                  {Array.from({ length: totalPages }, (_, i) => i + 1)
                    .filter((p) => p === 1 || p === totalPages || Math.abs(p - result.page) <= 2)
                    .map((p, i, arr) => (
                      <span key={p} className="flex items-center gap-1">
                        {i > 0 && p - arr[i - 1] > 1 && <span className="px-1 text-subtle">…</span>}
                        <Link
                          href={keep({ page: p === 1 ? undefined : String(p) })}
                          aria-current={p === result.page ? "page" : undefined}
                          className={cn("grid size-10 place-items-center rounded-xl text-sm", p === result.page ? "bg-brand-500 font-semibold text-white" : "border border-line-strong text-muted hover:text-white")}
                        >
                          {p}
                        </Link>
                      </span>
                    ))}
                </nav>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
