"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { saveProductImage } from "@/lib/storage";
import { uniqueSlug } from "@/lib/products-admin";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const opt = (f: FormData, k: string) => s(f, k) || null;
const refresh = () => {
  revalidatePath("/", "layout");
};

export async function saveCategoryAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const id = s(f, "id") || undefined;
    const name = s(f, "name");
    if (name.length < 2) return { ok: false, error: "Enter a category name." };
    const parentId = opt(f, "parentId");
    if (id && parentId) {
      // Prevent loops: the new parent can't be this category or one of its children.
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === id) return { ok: false, error: "A category can't be placed inside itself or its own subcategory." };
        cursor = (await db.category.findUnique({ where: { id: cursor }, select: { parentId: true } }))?.parentId ?? null;
      }
    }
    const image = f.get("image");
    const imageKey = image instanceof File && image.size > 0 ? (await saveProductImage(image, "categories")).key : undefined;
    const data = {
      name,
      slug: await uniqueSlug(s(f, "slug") || name, "category", id),
      description: opt(f, "description"),
      icon: opt(f, "icon"),
      parentId,
      sortOrder: Number(s(f, "sortOrder")) || 0,
      isVisible: f.get("isVisible") === "on",
      seoTitle: opt(f, "seoTitle"),
      seoDescription: opt(f, "seoDescription"),
      ...(imageKey ? { imageKey } : {}),
    };
    const cat = id ? await db.category.update({ where: { id }, data }) : await db.category.create({ data });
    await audit(user, id ? "category.update" : "category.create", "Category", cat.id, `${id ? "Updated" : "Created"} category “${name}”`);
    refresh();
    revalidatePath("/admin/categories");
    return { ok: true, message: "Category saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteCategoryAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const id = s(f, "id");
    const [products, children] = await Promise.all([db.product.count({ where: { categoryId: id, deletedAt: null } }), db.category.count({ where: { parentId: id, deletedAt: null } })]);
    if (products || children) return { ok: false, error: `This category still has ${products} product(s) and ${children} subcategory(ies). Move them first, or hide the category instead.` };
    const cat = await db.category.update({ where: { id }, data: { deletedAt: new Date(), isVisible: false, slug: `${id}~deleted` } });
    await audit(user, "category.delete", "Category", id, `Deleted category “${cat.name}”`);
    refresh();
    revalidatePath("/admin/categories");
    return { ok: true, message: "Category deleted." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveBrandAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const id = s(f, "id") || undefined;
    const name = s(f, "name");
    if (!name) return { ok: false, error: "Enter a brand name." };
    const website = opt(f, "website");
    if (website && !/^https?:\/\//.test(website)) return { ok: false, error: "The website must start with https://" };
    const data = { name, slug: await uniqueSlug(s(f, "slug") || name, "brand", id), website, isVisible: f.get("isVisible") === "on" };
    const b = id ? await db.brand.update({ where: { id }, data }) : await db.brand.create({ data });
    await audit(user, id ? "brand.update" : "brand.create", "Brand", b.id, `Saved brand “${name}”`);
    refresh();
    revalidatePath("/admin/brands");
    return { ok: true, message: "Brand saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveCollectionAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("products.manage");
    const id = s(f, "id") || undefined;
    const name = s(f, "name");
    if (!name) return { ok: false, error: "Enter a collection name." };
    const productIds = f.getAll("productIds").map(String).filter(Boolean);
    const data = { name, slug: await uniqueSlug(s(f, "slug") || name, "collection", id), description: opt(f, "description"), isVisible: f.get("isVisible") === "on", showOnHome: f.get("showOnHome") === "on", sortOrder: Number(s(f, "sortOrder")) || 0 };
    await db.$transaction(async (tx) => {
      const c = id ? await tx.collection.update({ where: { id }, data }) : await tx.collection.create({ data });
      await tx.collectionProduct.deleteMany({ where: { collectionId: c.id } });
      await tx.collectionProduct.createMany({ data: productIds.map((productId, i) => ({ collectionId: c.id, productId, sortOrder: i })), skipDuplicates: true });
      await audit(user, "collection.save", "Collection", c.id, `Saved collection “${name}” (${productIds.length} products)`, undefined, tx);
    });
    refresh();
    revalidatePath("/admin/brands");
    return { ok: true, message: "Collection saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteCollectionAction(f: FormData) {
  const user = await requireStaff("products.manage");
  const c = await db.collection.delete({ where: { id: s(f, "id") } });
  await audit(user, "collection.delete", "Collection", c.id, `Deleted collection “${c.name}”`);
  refresh();
  revalidatePath("/admin/brands");
}
