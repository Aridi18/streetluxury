import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma, ProductStatus, ProductType } from "@prisma/client";
import { Download, Plus, Upload } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { PageHeader, Pagination, Table } from "@/components/admin/ui";
import { ProductImage } from "@/components/store/product-image";
import { Alert, Badge, Button, Input, LinkButton, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Products" };
const PAGE = 40;
const STATUS_TONE = { ACTIVE: "success", DRAFT: "warning", HIDDEN: "neutral", ARCHIVED: "danger" } as const;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; type?: string; category?: string; page?: string; missingCost?: string; archived?: string; deleted?: string }> }) {
  await requireStaffPage("products.manage");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const and: Prisma.ProductWhereInput[] = [{ deletedAt: null }];
  if (sp.q) and.push({ OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { slug: { contains: sp.q, mode: "insensitive" } }, { variants: { some: { sku: { contains: sp.q, mode: "insensitive" } } } }, { brand: { name: { contains: sp.q, mode: "insensitive" } } }] });
  if (sp.status) and.push({ status: sp.status as ProductStatus });
  else and.push({ status: { not: "ARCHIVED" } });
  if (sp.type) and.push({ type: sp.type as ProductType });
  if (sp.category) and.push({ categoryId: sp.category });
  if (sp.missingCost) and.push({ isOnRequest: false, variants: { some: { costPrice: 0, isActive: true, deletedAt: null } } });
  const where = { AND: and };
  const [products, total, categories] = await Promise.all([
    db.product.findMany({ where, orderBy: [{ updatedAt: "desc" }], take: PAGE, skip: (page - 1) * PAGE, include: { images: { orderBy: { sortOrder: "asc" }, take: 1 }, category: true, variants: { where: { deletedAt: null } } } }),
    db.product.count({ where }),
    db.category.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
  ]);
  const qs = (extra: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...sp, ...extra }).filter(([, v]) => v) as [string, string][]).toString();
  const sel = "h-10 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm";
  return (
    <div>
      <PageHeader
        title="Products"
        description={`${total} product${total === 1 ? "" : "s"}`}
        actions={
          <>
            <a href="/api/admin/export/products" className={buttonClass("ghost", "sm")}><Download className="size-4" /> Export CSV</a>
            <LinkButton href="/admin/products/import" variant="secondary" size="sm"><Upload className="size-4" /> Import CSV</LinkButton>
            <LinkButton href="/admin/products/new" size="sm"><Plus className="size-4" /> Add product</LinkButton>
          </>
        }
      />
      {sp.archived && <Alert tone="info" className="mb-4">The product was archived: it has past orders, so it is kept for your records but hidden from the store.</Alert>}
      {sp.deleted && <Alert tone="success" className="mb-4">The product was deleted.</Alert>}
      {sp.missingCost && <Alert tone="warning" className="mb-4">Showing products with at least one option that has no cost price. <Link href="/admin/products" className="underline">Show all</Link></Alert>}
      <form method="get" className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-line bg-surface p-3">
        <Input name="q" defaultValue={sp.q} placeholder="Search name, SKU, brand…" className="h-10 min-w-56 flex-1" />
        <select name="status" defaultValue={sp.status ?? ""} className={sel} aria-label="Status"><option value="">Active, draft & hidden</option><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="HIDDEN">Hidden</option><option value="ARCHIVED">Archived</option></select>
        <select name="type" defaultValue={sp.type ?? ""} className={sel} aria-label="Type"><option value="">All types</option>{["PHYSICAL", "DIGITAL", "SUBSCRIPTION", "LICENSE", "SERVICE"].map((t) => <option key={t} value={t}>{t.toLowerCase()}</option>)}</select>
        <select name="category" defaultValue={sp.category ?? ""} className={sel} aria-label="Category"><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <Button size="sm" className="h-10">Filter</Button>
      </form>
      <Table>
        <thead><tr><th>Product</th><th>Type</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th className="text-right">Sold</th></tr></thead>
        <tbody>
          {products.map((p) => {
            const tracked = p.variants.filter((v) => v.trackInventory);
            const stock = tracked.reduce((s, v) => s + v.stockOnHand, 0);
            const missingCost = p.variants.some((v) => v.costPrice === 0 && v.isActive);
            return (
              <tr key={p.id}>
                <td>
                  <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3">
                    <span className="size-11 shrink-0 overflow-hidden rounded-lg"><ProductImage imageKey={p.images[0]?.key ?? null} alt="" title={p.title} sizes="44px" /></span>
                    <span><span className="block font-semibold text-white hover:text-brand-200">{p.title}</span><span className="text-xs text-subtle">{p.variants.length} option{p.variants.length === 1 ? "" : "s"}{missingCost && !p.isOnRequest ? " · no cost price" : ""}</span></span>
                  </Link>
                </td>
                <td className="text-muted">{p.type.toLowerCase()}</td>
                <td className="text-muted">{p.category?.name ?? "—"}</td>
                <td>{p.isOnRequest ? <span className="text-brand-200">On request</span> : p.minPrice === p.maxPrice ? formatMoney(p.minPrice) : `${formatMoney(p.minPrice)} – ${formatMoney(p.maxPrice)}`}</td>
                <td>{tracked.length ? <span className={stock <= 0 ? "text-danger" : ""}>{stock}</span> : <span className="text-subtle">Not tracked</span>}</td>
                <td><Badge tone={STATUS_TONE[p.status]}>{p.status.toLowerCase()}</Badge></td>
                <td className="text-right text-muted">{p.salesCount}</td>
              </tr>
            );
          })}
          {!products.length && <tr><td colSpan={7} className="py-10 text-center text-subtle">No products found.</td></tr>}
        </tbody>
      </Table>
      <Pagination page={page} total={total} pageSize={PAGE} href={(p) => `/admin/products?${qs({ page: String(p) })}`} />
    </div>
  );
}
