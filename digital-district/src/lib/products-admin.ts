import { Prisma, type DigitalDeliveryMode, type ProductStatus, type ProductType, type User } from "@prisma/client";
import { db, type Tx } from "./db";
import { UserError } from "./errors";
import { audit } from "./audit";
import { syncProductAggregates } from "./catalog-sync";
import { parseMoney } from "./money";
import { parseCsv } from "./csv";

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

export async function uniqueSlug(base: string, table: "product" | "category" | "brand" | "collection", excludeId?: string, client: Tx | typeof db = db) {
  const root = slugify(base) || "item";
  for (let i = 0; i < 200; i++) {
    const slug = i === 0 ? root : `${root}-${i + 1}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (client[table] as any).findUnique({ where: { slug }, select: { id: true } });
    if (!found || found.id === excludeId) return slug;
  }
  throw new UserError("Could not create a unique web address. Try a different name.");
}

export async function uniqueSku(base: string, client: Tx | typeof db = db, excludeId?: string) {
  const root = base.toUpperCase().replace(/[^A-Z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "SKU";
  for (let i = 0; i < 500; i++) {
    const sku = i === 0 ? root : `${root}-${i + 1}`;
    const found = await client.productVariant.findUnique({ where: { sku }, select: { id: true } });
    if (!found || found.id === excludeId) return sku;
  }
  throw new UserError("Could not create a unique SKU.");
}

async function setTags(tx: Tx, productId: string, tags: string[]) {
  await tx.productTag.deleteMany({ where: { productId } });
  for (const name of [...new Set(tags.map((t) => t.trim()).filter(Boolean))].slice(0, 30)) {
    const slug = slugify(name);
    if (!slug) continue;
    const tag = await tx.tag.upsert({ where: { slug }, create: { name, slug }, update: {} });
    await tx.productTag.create({ data: { productId, tagId: tag.id } });
  }
}

// ───────────── Quick create (simple form for non-technical use) ─────────────

export async function quickCreateProduct(
  actor: User,
  input: { title: string; type: ProductType; categoryId: string | null; price: number; costPrice: number; stock: number | null; shortDescription: string | null; description: string | null; status: ProductStatus },
) {
  if (input.title.trim().length < 2) throw new UserError("Enter a product name.");
  return db.$transaction(async (tx) => {
    const slug = await uniqueSlug(input.title, "product", undefined, tx);
    const track = input.type === "PHYSICAL";
    const product = await tx.product.create({
      data: {
        title: input.title.trim(),
        slug,
        type: input.type,
        status: input.status,
        categoryId: input.categoryId,
        shortDescription: input.shortDescription,
        description: input.description,
        publishedAt: input.status === "ACTIVE" ? new Date() : null,
        variants: {
          create: {
            sku: await uniqueSku(slug, tx),
            name: "Default",
            price: input.price,
            costPrice: input.costPrice,
            trackInventory: track,
            stockOnHand: track ? input.stock ?? 0 : 0,
            isDefault: true,
          },
        },
      },
      include: { variants: true },
    });
    if (track && (input.stock ?? 0) > 0) {
      await tx.inventoryMovement.create({ data: { variantId: product.variants[0].id, delta: input.stock!, quantityAfter: input.stock!, reason: "MANUAL_ADJUSTMENT", note: "Initial stock", actorId: actor.id, unitCost: input.costPrice } });
    }
    await syncProductAggregates(product.id, tx);
    await audit(actor, "product.create", "Product", product.id, `Created “${product.title}”`, undefined, tx);
    return product;
  });
}

// ───────────── Full editor ─────────────

export type VariantInput = {
  id?: string;
  name: string;
  optionValues: Record<string, string>;
  sku: string;
  price: number;
  compareAtPrice: number | null;
  costPrice: number;
  trackInventory: boolean;
  initialStock: number; // only used for new variants
  allowBackorder: boolean;
  lowStockThreshold: number;
  durationDays: number | null;
  weightGrams: number | null;
  isActive: boolean;
};

export type ProductInput = {
  title: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  type: ProductType;
  status: ProductStatus;
  categoryId: string | null;
  brandId: string | null;
  newBrand: string | null;
  tags: string[];
  badge: string | null;
  isFeatured: boolean;
  isBestseller: boolean;
  isOnRequest: boolean;
  videoUrl: string | null;
  specifications: { label: string; value: string }[];
  customFields: { key: string; label: string; type: string; required: boolean; options?: string[]; placeholder?: string }[];
  allowCustomerNote: boolean;
  deliveryMethod: string | null;
  deliveryEstimate: string | null;
  digitalDeliveryMode: DigitalDeliveryMode;
  deliveryInstructions: string | null;
  activationInstructions: string | null;
  warranty: string | null;
  returnPolicy: string | null;
  terms: string | null;
  freeShipping: boolean;
  shippingSurcharge: number;
  seoTitle: string | null;
  seoDescription: string | null;
  sortOrder: number;
  variants: VariantInput[];
};

export async function updateProduct(actor: User, productId: string, input: ProductInput) {
  if (input.title.trim().length < 2) throw new UserError("Enter a product name.");
  if (!input.isOnRequest && input.variants.filter((v) => v.isActive).length === 0) throw new UserError("Add at least one active option with a price, or mark the product as “on request”.");
  if (input.videoUrl && !/^https:\/\//.test(input.videoUrl)) throw new UserError("The video link must start with https://");
  const names = input.variants.map((v) => v.name.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new UserError("Each option needs a different name.");
  for (const v of input.variants) {
    if (!v.name.trim()) throw new UserError("Every option needs a name.");
    if (v.price < 0 || v.costPrice < 0) throw new UserError("Prices cannot be negative.");
    if (v.compareAtPrice != null && v.compareAtPrice <= v.price) v.compareAtPrice = null;
  }
  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.product.findUnique({ where: { id: productId }, include: { variants: { where: { deletedAt: null } } } });
      if (!existing) throw new UserError("Product not found.");
      const slug = await uniqueSlug(input.slug || input.title, "product", productId, tx);
      let brandId = input.brandId;
      if (input.newBrand?.trim()) {
        const bslug = slugify(input.newBrand);
        brandId = (await tx.brand.upsert({ where: { slug: bslug }, create: { name: input.newBrand.trim(), slug: bslug }, update: {} })).id;
      }
      await tx.product.update({
        where: { id: productId },
        data: {
          title: input.title.trim(),
          slug,
          shortDescription: input.shortDescription,
          description: input.description,
          type: input.type,
          status: input.status,
          categoryId: input.categoryId,
          brandId,
          badge: input.badge,
          isFeatured: input.isFeatured,
          isBestseller: input.isBestseller,
          isOnRequest: input.isOnRequest,
          videoUrl: input.videoUrl,
          specifications: input.specifications,
          customFields: input.customFields,
          allowCustomerNote: input.allowCustomerNote,
          deliveryMethod: input.deliveryMethod,
          deliveryEstimate: input.deliveryEstimate,
          digitalDeliveryMode: input.digitalDeliveryMode,
          deliveryInstructions: input.deliveryInstructions,
          activationInstructions: input.activationInstructions,
          warranty: input.warranty,
          returnPolicy: input.returnPolicy,
          terms: input.terms,
          freeShipping: input.freeShipping,
          shippingSurcharge: input.shippingSurcharge,
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          sortOrder: input.sortOrder,
          publishedAt: input.status === "ACTIVE" ? existing.publishedAt ?? new Date() : existing.publishedAt,
        },
      });
      await setTags(tx, productId, input.tags);

      const keep = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
      for (const old of existing.variants) {
        if (!keep.has(old.id)) {
          // Soft delete: past orders keep pointing at the variant they bought.
          await tx.productVariant.update({ where: { id: old.id }, data: { deletedAt: new Date(), isActive: false, sku: `${old.sku}~deleted~${Date.now().toString(36)}` } });
        }
      }
      for (const [i, v] of input.variants.entries()) {
        const sku = await uniqueSku(v.sku || `${slug}-${i + 1}`, tx, v.id);
        const data = {
          name: v.name.trim(),
          optionValues: v.optionValues,
          sku,
          price: v.price,
          compareAtPrice: v.compareAtPrice,
          costPrice: v.costPrice,
          trackInventory: v.trackInventory,
          allowBackorder: v.allowBackorder,
          lowStockThreshold: v.lowStockThreshold,
          durationDays: v.durationDays,
          weightGrams: v.weightGrams,
          isActive: v.isActive,
          isDefault: i === 0,
          sortOrder: i,
        };
        if (v.id && existing.variants.some((x) => x.id === v.id)) {
          const before = existing.variants.find((x) => x.id === v.id)!;
          await tx.productVariant.update({ where: { id: v.id }, data });
          if (before.costPrice !== v.costPrice || before.price !== v.price) {
            await audit(actor, "product.price", "ProductVariant", v.id, `${sku}: price ${before.price / 100} → ${v.price / 100}, cost ${before.costPrice / 100} → ${v.costPrice / 100}`, undefined, tx);
          }
        } else {
          const created = await tx.productVariant.create({ data: { ...data, productId, stockOnHand: v.trackInventory ? Math.max(0, v.initialStock) : 0 } });
          if (v.trackInventory && v.initialStock > 0) {
            await tx.inventoryMovement.create({ data: { variantId: created.id, delta: v.initialStock, quantityAfter: v.initialStock, reason: "MANUAL_ADJUSTMENT", note: "Initial stock", actorId: actor.id } });
          }
        }
      }
      await syncProductAggregates(productId, tx);
      await audit(actor, "product.update", "Product", productId, `Updated “${input.title.trim()}”`, undefined, tx);
      return { slug };
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new UserError("That SKU or web address is already used by another product.");
    throw err;
  }
}

export async function duplicateProduct(actor: User, productId: string) {
  return db.$transaction(async (tx) => {
    const p = await tx.product.findUnique({ where: { id: productId }, include: { variants: { where: { deletedAt: null } }, images: true, tags: true } });
    if (!p) throw new UserError("Product not found.");
    const slug = await uniqueSlug(`${p.slug}-copy`, "product", undefined, tx);
    const { id: _id, createdAt: _c, updatedAt: _u, salesCount: _s, viewCount: _v, ratingAvg: _r, ratingCount: _rc, publishedAt: _p, deletedAt: _d, ...rest } = p;
    void _id; void _c; void _u; void _s; void _v; void _r; void _rc; void _p; void _d;
    const copy = await tx.product.create({
      data: {
        ...rest,
        variants: undefined,
        images: undefined,
        tags: undefined,
        title: `${p.title} (copy)`,
        slug,
        status: "DRAFT",
        specifications: p.specifications ?? [],
        customFields: p.customFields ?? [],
      } as Prisma.ProductUncheckedCreateInput,
    });
    for (const v of p.variants) {
      await tx.productVariant.create({
        data: {
          productId: copy.id, sku: await uniqueSku(`${v.sku}-COPY`, tx), name: v.name, optionValues: v.optionValues ?? {}, price: v.price, compareAtPrice: v.compareAtPrice, costPrice: v.costPrice,
          trackInventory: v.trackInventory, stockOnHand: 0, allowBackorder: v.allowBackorder, lowStockThreshold: v.lowStockThreshold, durationDays: v.durationDays, weightGrams: v.weightGrams,
          isDefault: v.isDefault, isActive: v.isActive, sortOrder: v.sortOrder,
        },
      });
    }
    for (const img of p.images) await tx.productImage.create({ data: { productId: copy.id, key: img.key, alt: img.alt, width: img.width, height: img.height, sortOrder: img.sortOrder } });
    for (const t of p.tags) await tx.productTag.create({ data: { productId: copy.id, tagId: t.tagId } });
    await syncProductAggregates(copy.id, tx);
    await audit(actor, "product.duplicate", "Product", copy.id, `Duplicated “${p.title}”`, undefined, tx);
    return copy;
  });
}

/** Products with orders are archived (kept for history); unsold products are soft-deleted. */
export async function deleteProduct(actor: User, productId: string) {
  const p = await db.product.findUnique({ where: { id: productId }, include: { _count: { select: { orderItems: true } } } });
  if (!p) throw new UserError("Product not found.");
  await db.product.update({ where: { id: productId }, data: { status: "ARCHIVED", deletedAt: p._count.orderItems ? null : new Date(), slug: p._count.orderItems ? p.slug : `${p.slug}~deleted~${Date.now().toString(36)}` } });
  await audit(actor, p._count.orderItems ? "product.archive" : "product.delete", "Product", productId, `${p._count.orderItems ? "Archived" : "Deleted"} “${p.title}”`);
  return p._count.orderItems ? "archived" : "deleted";
}

// ───────────── CSV import ─────────────
// One row per variant. Rows sharing product_slug belong to the same product. Matching SKUs are updated; new ones are created.

const TYPES: ProductType[] = ["PHYSICAL", "DIGITAL", "SUBSCRIPTION", "LICENSE", "SERVICE"];
const STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"];

export type ImportReport = { created: number; updated: number; variants: number; errors: string[] };

export async function importProductsCsv(actor: User, text: string, dryRun: boolean): Promise<ImportReport> {
  const { rows, errors } = parseCsv(text);
  const report: ImportReport = { created: 0, updated: 0, variants: 0, errors: [...errors] };
  if (!rows.length) {
    report.errors.push("The file has no rows.");
    return report;
  }
  const required = ["title", "type", "price"];
  const missing = required.filter((c) => !(c in rows[0]));
  if (missing.length) {
    report.errors.push(`Missing column(s): ${missing.join(", ")}. Export your products first to get a template.`);
    return report;
  }
  const categories = await db.category.findMany({ where: { deletedAt: null } });
  const groups = new Map<string, { row: Record<string, string>; line: number }[]>();
  rows.forEach((row, i) => {
    const key = (row.product_slug || slugify(row.title || "")).trim();
    if (!key) report.errors.push(`Row ${i + 2}: missing title.`);
    else groups.set(key, [...(groups.get(key) ?? []), { row, line: i + 2 }]);
  });
  const yes = (v?: string) => /^(yes|true|1|y)$/i.test((v ?? "").trim());
  type Parsed = { slug: string; first: Record<string, string>; type: ProductType; status: ProductStatus; categoryId: string | null; variants: { line: number; row: Record<string, string>; price: number; compareAt: number | null; cost: number; stock: number | null; duration: number | null; options: Record<string, string> }[] };
  const parsed: Parsed[] = [];
  for (const [slug, items] of groups) {
    const first = items[0].row;
    const type = (first.type || "").trim().toUpperCase() as ProductType;
    const status = ((first.status || "DRAFT").trim().toUpperCase() as ProductStatus) || "DRAFT";
    if (!TYPES.includes(type)) report.errors.push(`Row ${items[0].line}: type must be one of ${TYPES.join(", ")}.`);
    if (!STATUSES.includes(status)) report.errors.push(`Row ${items[0].line}: status must be one of ${STATUSES.join(", ")}.`);
    const category = first.category ? categories.find((c) => c.slug === first.category.trim() || c.name.toLowerCase() === first.category.trim().toLowerCase()) : null;
    if (first.category && !category) report.errors.push(`Row ${items[0].line}: unknown category “${first.category}”.`);
    const variants: Parsed["variants"] = [];
    for (const { row, line } of items) {
      const price = parseMoney(row.price ?? "");
      if (price == null && !yes(first.on_request)) report.errors.push(`Row ${line}: invalid price “${row.price}”.`);
      const compareAt = row.compare_at_price ? parseMoney(row.compare_at_price) : null;
      const cost = row.cost_price ? parseMoney(row.cost_price) : 0;
      if (row.compare_at_price && compareAt == null) report.errors.push(`Row ${line}: invalid compare_at_price.`);
      if (row.cost_price && cost == null) report.errors.push(`Row ${line}: invalid cost_price.`);
      const stock = row.stock ? Number(row.stock) : null;
      if (row.stock && (!Number.isInteger(stock) || stock! < 0)) report.errors.push(`Row ${line}: stock must be a whole number.`);
      const duration = row.duration_days ? Number(row.duration_days) : null;
      const options = Object.fromEntries((row.option_values ?? "").split("|").map((p) => p.split("=").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]));
      if (price != null) variants.push({ line, row, price, compareAt: compareAt ?? null, cost: cost ?? 0, stock, duration: duration && Number.isFinite(duration) ? duration : null, options });
    }
    parsed.push({ slug, first, type, status, categoryId: category?.id ?? null, variants });
  }
  if (report.errors.length || dryRun) {
    if (!report.errors.length) for (const p of parsed) {
      const exists = await db.product.findUnique({ where: { slug: p.slug } });
      if (exists) report.updated++;
      else report.created++;
      report.variants += p.variants.length;
    }
    return report;
  }
  await db.$transaction(
    async (tx) => {
      for (const p of parsed) {
        const f = p.first;
        let brandId: string | null = null;
        if (f.brand?.trim()) {
          const bslug = slugify(f.brand);
          brandId = (await tx.brand.upsert({ where: { slug: bslug }, create: { name: f.brand.trim(), slug: bslug }, update: {} })).id;
        }
        const data = {
          title: f.title.trim(),
          type: p.type,
          status: p.status,
          categoryId: p.categoryId,
          brandId,
          shortDescription: f.short_description || null,
          description: f.description || null,
          badge: f.badge || null,
          isFeatured: yes(f.featured),
          isOnRequest: yes(f.on_request),
        };
        const existing = await tx.product.findUnique({ where: { slug: p.slug } });
        const product = existing
          ? await tx.product.update({ where: { id: existing.id }, data })
          : await tx.product.create({ data: { ...data, slug: await uniqueSlug(p.slug, "product", undefined, tx), publishedAt: p.status === "ACTIVE" ? new Date() : null } });
        if (existing) report.updated++;
        else report.created++;
        if (f.tags !== undefined) await setTags(tx, product.id, (f.tags ?? "").split("|"));
        for (const [i, v] of p.variants.entries()) {
          const sku = v.row.sku?.trim();
          const current = sku ? await tx.productVariant.findUnique({ where: { sku } }) : null;
          if (current && current.productId !== product.id) throw new UserError(`Row ${v.line}: SKU ${sku} belongs to another product.`);
          const track = v.row.track_inventory ? yes(v.row.track_inventory) : p.type === "PHYSICAL";
          const vdata = {
            name: v.row.variant_name?.trim() || "Default",
            optionValues: v.options,
            price: v.price,
            compareAtPrice: v.compareAt != null && v.compareAt > v.price ? v.compareAt : null,
            costPrice: v.cost,
            trackInventory: track,
            durationDays: v.duration,
            isActive: v.row.active ? yes(v.row.active) : true,
            sortOrder: i,
            isDefault: i === 0,
          };
          if (current) {
            await tx.productVariant.update({ where: { id: current.id }, data: vdata });
            if (track && v.stock != null && v.stock !== current.stockOnHand) {
              await tx.productVariant.update({ where: { id: current.id }, data: { stockOnHand: v.stock } });
              await tx.inventoryMovement.create({ data: { variantId: current.id, delta: v.stock - current.stockOnHand, quantityAfter: v.stock, reason: "STOCK_COUNT", note: "CSV import", actorId: actor.id } });
            }
          } else {
            const created = await tx.productVariant.create({ data: { ...vdata, productId: product.id, sku: await uniqueSku(sku || `${product.slug}-${i + 1}`, tx), stockOnHand: track ? v.stock ?? 0 : 0 } });
            if (track && v.stock) await tx.inventoryMovement.create({ data: { variantId: created.id, delta: v.stock, quantityAfter: v.stock, reason: "STOCK_COUNT", note: "CSV import", actorId: actor.id } });
          }
          report.variants++;
        }
        await syncProductAggregates(product.id, tx);
      }
      await audit(actor, "product.import", "Product", null, `CSV import: ${report.created} created, ${report.updated} updated, ${report.variants} variants`, undefined, tx);
    },
    { timeout: 120_000 },
  );
  return report;
}
