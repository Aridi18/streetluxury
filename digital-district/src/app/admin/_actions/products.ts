"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { DigitalDeliveryMode, ProductStatus, ProductType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, UserError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { audit } from "@/lib/audit";
import { deleteImageRenditions, deleteStored, saveDigitalFile, saveProductImage } from "@/lib/storage";
import { addLicenseKeys } from "@/lib/fulfillment";
import { deleteProduct, duplicateProduct, importProductsCsv, quickCreateProduct, slugify, updateProduct, type ImportReport, type ProductInput, type VariantInput } from "@/lib/products-admin";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => s(f, k) || null;
const TYPES: ProductType[] = ["PHYSICAL", "DIGITAL", "SUBSCRIPTION", "LICENSE", "SERVICE"];
const STATUSES: ProductStatus[] = ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"];

function revalidateProduct(id: string) {
  revalidatePath(`/admin/products/${id}`);
  revalidatePath("/admin/products");
  revalidatePath("/", "layout");
}

export async function quickCreateProductAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  let id: string;
  try {
    const user = await requireStaff("products.manage");
    const type = s(f, "type") as ProductType;
    if (!TYPES.includes(type)) return { ok: false, error: "Choose a product type." };
    const price = parseMoney(s(f, "price"));
    if (price == null) return { ok: false, error: "Enter the selling price (for example 14 or 9.50)." };
    const cost = s(f, "cost") ? parseMoney(s(f, "cost")) : 0;
    if (cost == null) return { ok: false, error: "Enter a valid cost price." };
    const stock = s(f, "stock") ? Number(s(f, "stock")) : null;
    if (stock != null && (!Number.isInteger(stock) || stock < 0)) return { ok: false, error: "Stock must be a whole number." };
    const product = await quickCreateProduct(user, {
      title: s(f, "title"),
      type,
      categoryId: opt(f, "categoryId"),
      price,
      costPrice: cost,
      stock,
      shortDescription: opt(f, "shortDescription"),
      description: opt(f, "description"),
      status: f.get("publish") === "on" ? "ACTIVE" : "DRAFT",
    });
    for (const file of f.getAll("images")) {
      if (file instanceof File && file.size > 0) {
        const img = await saveProductImage(file);
        await db.productImage.create({ data: { productId: product.id, key: img.key, width: img.width, height: img.height, alt: product.title, sortOrder: await db.productImage.count({ where: { productId: product.id } }) } });
      }
    }
    id = product.id;
    revalidatePath("/", "layout");
  } catch (err) {
    return toActionError(err);
  }
  redirect(`/admin/products/${id}?created=1`);
}

export async function saveProductAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const id = s(f, "id");
    const type = s(f, "type") as ProductType;
    const status = s(f, "status") as ProductStatus;
    if (!TYPES.includes(type) || !STATUSES.includes(status)) return { ok: false, error: "Choose a type and status." };
    const rawVariants = JSON.parse(s(f, "variantsJson") || "[]") as Record<string, unknown>[];
    const variants: VariantInput[] = rawVariants.map((v, i) => {
      const money = (key: string, required: boolean) => {
        const raw = String(v[key] ?? "").trim();
        if (!raw) {
          if (required) throw new UserError(`Option ${i + 1}: enter a price.`);
          return null;
        }
        const c = parseMoney(raw);
        if (c == null) throw new UserError(`Option ${i + 1}: “${raw}” is not a valid amount.`);
        return c;
      };
      const int = (key: string) => {
        const raw = String(v[key] ?? "").trim();
        if (!raw) return null;
        const n = Number(raw);
        if (!Number.isInteger(n) || n < 0) throw new UserError(`Option ${i + 1}: ${key} must be a whole number.`);
        return n;
      };
      return {
        id: v.id ? String(v.id) : undefined,
        name: String(v.name ?? "").trim() || "Default",
        optionValues: (v.optionValues ?? {}) as Record<string, string>,
        sku: String(v.sku ?? "").trim(),
        price: money("price", true)!,
        compareAtPrice: money("compareAtPrice", false),
        costPrice: money("costPrice", false) ?? 0,
        trackInventory: Boolean(v.trackInventory),
        initialStock: int("initialStock") ?? 0,
        allowBackorder: Boolean(v.allowBackorder),
        lowStockThreshold: int("lowStockThreshold") ?? 3,
        durationDays: int("durationDays"),
        weightGrams: int("weightGrams"),
        isActive: v.isActive !== false,
      };
    });
    const specs = s(f, "specifications").split("\n").map((l) => l.split(/:(.*)/s)).filter((p) => p[0]?.trim()).map((p) => ({ label: p[0].trim(), value: (p[1] ?? "").trim() }));
    const customFields = (JSON.parse(s(f, "customFieldsJson") || "[]") as { label: string; type: string; required: boolean; options: string }[])
      .filter((c) => c.label?.trim())
      .map((c) => ({ key: slugify(c.label).replace(/-/g, "_") || "field", label: c.label.trim(), type: ["text", "email", "textarea", "select"].includes(c.type) ? c.type : "text", required: Boolean(c.required), options: c.type === "select" ? c.options.split(",").map((o) => o.trim()).filter(Boolean) : undefined }));
    const surcharge = s(f, "shippingSurcharge") ? parseMoney(s(f, "shippingSurcharge")) : 0;
    if (surcharge == null) return { ok: false, error: "Enter a valid delivery surcharge." };
    const input: ProductInput = {
      title: s(f, "title"),
      slug: s(f, "slug"),
      shortDescription: opt(f, "shortDescription"),
      description: opt(f, "description"),
      type,
      status,
      categoryId: opt(f, "categoryId"),
      brandId: opt(f, "brandId"),
      newBrand: opt(f, "newBrand"),
      tags: s(f, "tags").split(","),
      badge: opt(f, "badge"),
      isFeatured: f.get("isFeatured") === "on",
      isBestseller: f.get("isBestseller") === "on",
      isOnRequest: f.get("isOnRequest") === "on",
      videoUrl: opt(f, "videoUrl"),
      specifications: specs,
      customFields,
      allowCustomerNote: f.get("allowCustomerNote") === "on",
      deliveryMethod: opt(f, "deliveryMethod"),
      deliveryEstimate: opt(f, "deliveryEstimate"),
      digitalDeliveryMode: (s(f, "digitalDeliveryMode") === "AUTOMATIC" ? "AUTOMATIC" : "MANUAL") as DigitalDeliveryMode,
      deliveryInstructions: opt(f, "deliveryInstructions"),
      activationInstructions: opt(f, "activationInstructions"),
      warranty: opt(f, "warranty"),
      returnPolicy: opt(f, "returnPolicy"),
      terms: opt(f, "terms"),
      freeShipping: f.get("freeShipping") === "on",
      shippingSurcharge: surcharge,
      seoTitle: opt(f, "seoTitle"),
      seoDescription: opt(f, "seoDescription"),
      sortOrder: Number(s(f, "sortOrder")) || 0,
      variants,
    };
    await updateProduct(user, id, input);
    revalidateProduct(id);
    return { ok: true, message: "Product saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function duplicateProductAction(f: FormData) {
  const user = await requireStaff("products.manage");
  const copy = await duplicateProduct(user, s(f, "id"));
  redirect(`/admin/products/${copy.id}?duplicated=1`);
}

export async function deleteProductAction(f: FormData) {
  const user = await requireStaff("products.manage");
  const result = await deleteProduct(user, s(f, "id"));
  revalidatePath("/", "layout");
  redirect(`/admin/products?${result}=1`);
}

export async function uploadImagesAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    await requireStaff("products.manage");
    const productId = s(f, "productId");
    const product = await db.product.findUniqueOrThrow({ where: { id: productId } });
    let n = await db.productImage.count({ where: { productId } });
    const files = f.getAll("images").filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) return { ok: false, error: "Choose one or more images." };
    for (const file of files.slice(0, 20)) {
      const img = await saveProductImage(file);
      await db.productImage.create({ data: { productId, key: img.key, width: img.width, height: img.height, alt: product.title, sortOrder: n++ } });
    }
    revalidateProduct(productId);
    return { ok: true, message: `${files.length} image(s) uploaded.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function imageAction(f: FormData) {
  await requireStaff("products.manage");
  const id = s(f, "imageId");
  const img = await db.productImage.findUniqueOrThrow({ where: { id } });
  const op = s(f, "op");
  if (op === "delete") {
    await db.productImage.delete({ where: { id } });
    const stillUsed = await db.productImage.count({ where: { key: img.key } });
    if (!stillUsed) await deleteImageRenditions(img.key);
  } else if (op === "alt") {
    await db.productImage.update({ where: { id }, data: { alt: s(f, "alt").slice(0, 200) || null } });
  } else if (op === "up" || op === "down" || op === "first") {
    const all = await db.productImage.findMany({ where: { productId: img.productId }, orderBy: { sortOrder: "asc" } });
    const idx = all.findIndex((x) => x.id === id);
    const order = all.map((x) => x.id);
    order.splice(idx, 1);
    order.splice(op === "first" ? 0 : op === "up" ? Math.max(0, idx - 1) : Math.min(all.length - 1, idx + 1), 0, id);
    await db.$transaction(order.map((imageId, i) => db.productImage.update({ where: { id: imageId }, data: { sortOrder: i } })));
  }
  revalidateProduct(img.productId);
}

export async function uploadDigitalFileAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const productId = s(f, "productId");
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a file." };
    const saved = await saveDigitalFile(file);
    await db.digitalAsset.create({ data: { productId, variantId: opt(f, "variantId"), fileKey: saved.key, fileName: saved.fileName, mimeType: saved.mimeType, size: saved.size } });
    await audit(user, "product.file_upload", "Product", productId, `Uploaded digital file ${saved.fileName}`);
    revalidateProduct(productId);
    return { ok: true, message: "File uploaded. It is stored privately and only delivered to paying customers." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteDigitalFileAction(f: FormData) {
  const user = await requireStaff("products.manage");
  const asset = await db.digitalAsset.findUniqueOrThrow({ where: { id: s(f, "assetId") } });
  const used = await db.digitalDelivery.count({ where: { assetIds: { has: asset.id } } });
  if (used) await db.digitalAsset.update({ where: { id: asset.id }, data: { isActive: false } });
  else {
    await db.digitalAsset.delete({ where: { id: asset.id } });
    await deleteStored(asset.fileKey);
  }
  await audit(user, "product.file_delete", "Product", asset.productId, `${used ? "Disabled" : "Deleted"} digital file ${asset.fileName}`);
  revalidateProduct(asset.productId);
}

export async function addLicenseKeysAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const res = await addLicenseKeys(user, s(f, "variantId"), String(f.get("keys") ?? ""));
    revalidateProduct(s(f, "productId"));
    return { ok: true, message: `${res.added} key(s) added${res.duplicates ? `, ${res.duplicates} duplicate(s) skipped` : ""}.` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function importProductsAction(_p: ActionResult<ImportReport> | null, f: FormData): Promise<ActionResult<ImportReport>> {
  try {
    const user = await requireStaff("products.manage");
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a CSV file." };
    if (file.size > 5 * 1024 * 1024) return { ok: false, error: "The CSV file must be 5 MB or smaller." };
    const dryRun = f.get("mode") !== "import";
    const report = await importProductsCsv(user, await file.text(), dryRun);
    if (report.errors.length) return { ok: false, error: `Nothing was imported. Fix these problems and try again:\n${report.errors.slice(0, 15).join("\n")}` };
    if (!dryRun) revalidatePath("/", "layout");
    return { ok: true, data: report, message: dryRun ? `Check passed: ${report.created} new product(s), ${report.updated} update(s), ${report.variants} option(s). Choose “Import now” to apply.` : `Imported: ${report.created} created, ${report.updated} updated, ${report.variants} option(s).` };
  } catch (err) {
    return toActionError(err);
  }
}
