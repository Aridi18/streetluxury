"use server";

import { revalidatePath } from "next/cache";
import { Prisma, type PromotionScope, type PromotionType } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { zonedDateTime } from "@/lib/time";
import { audit } from "@/lib/audit";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function savePromotionAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("promotions.manage");
    const id = s(f, "id") || undefined;
    const type = s(f, "type") as PromotionType;
    const scope = s(f, "scope") as PromotionScope;
    if (!["PERCENT", "FIXED", "FREE_SHIPPING"].includes(type) || !["ALL", "PRODUCTS", "CATEGORIES"].includes(scope)) return { ok: false, error: "Choose a discount type and what it applies to." };
    const code = s(f, "code").toUpperCase().replace(/\s+/g, "") || null;
    if (code && !/^[A-Z0-9_-]{3,40}$/.test(code)) return { ok: false, error: "Codes use 3–40 letters, numbers, - or _." };
    if (!code && type === "FREE_SHIPPING") return { ok: false, error: "Free delivery offers need a code (automatic free delivery is set per delivery area)." };
    let value = 0;
    if (type === "PERCENT") {
      const pct = Number(s(f, "value"));
      if (!(pct > 0 && pct <= 100)) return { ok: false, error: "Enter a percentage between 1 and 100." };
      value = Math.round(pct * 100);
    } else if (type === "FIXED") {
      const c = parseMoney(s(f, "value"));
      if (!c) return { ok: false, error: "Enter the discount amount." };
      value = c;
    }
    const money = (k: string) => (s(f, k) ? parseMoney(s(f, k)) : null);
    const int = (k: string) => (s(f, k) ? Math.max(0, Math.floor(Number(s(f, k)))) : null);
    const startsAt = s(f, "startsAt") ? zonedDateTime(s(f, "startsAt")) : null;
    const endsAt = s(f, "endsAt") ? zonedDateTime(s(f, "endsAt")) : null;
    if (startsAt && endsAt && endsAt <= startsAt) return { ok: false, error: "The end date must be after the start date." };
    const productIds = scope === "PRODUCTS" ? f.getAll("productIds").map(String) : [];
    const categoryIds = scope === "CATEGORIES" ? f.getAll("categoryIds").map(String) : [];
    if (scope === "PRODUCTS" && !productIds.length) return { ok: false, error: "Choose at least one product." };
    if (scope === "CATEGORIES" && !categoryIds.length) return { ok: false, error: "Choose at least one category." };
    const data = {
      name: s(f, "name") || code || "Promotion",
      code,
      type,
      value,
      scope,
      description: s(f, "description") || null,
      minOrderAmount: money("minOrderAmount"),
      maxDiscount: money("maxDiscount"),
      usageLimit: int("usageLimit"),
      usageLimitPerCustomer: int("usageLimitPerCustomer"),
      firstOrderOnly: f.get("firstOrderOnly") === "on",
      startsAt,
      endsAt,
      isActive: f.get("isActive") === "on",
      showOnHome: f.get("showOnHome") === "on",
    };
    await db.$transaction(async (tx) => {
      const p = id ? await tx.promotion.update({ where: { id }, data }) : await tx.promotion.create({ data });
      await tx.promotionProduct.deleteMany({ where: { promotionId: p.id } });
      await tx.promotionCategory.deleteMany({ where: { promotionId: p.id } });
      if (productIds.length) await tx.promotionProduct.createMany({ data: productIds.map((productId) => ({ promotionId: p.id, productId })) });
      if (categoryIds.length) await tx.promotionCategory.createMany({ data: categoryIds.map((categoryId) => ({ promotionId: p.id, categoryId })) });
      await audit(user, id ? "promotion.update" : "promotion.create", "Promotion", p.id, `${code ? `Code ${code}` : `Sale “${data.name}”`}`, undefined, tx);
    });
    revalidatePath("/admin/promotions");
    revalidatePath("/", "layout");
    return { ok: true, message: "Promotion saved." };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { ok: false, error: "That code is already used by another promotion." };
    return toActionError(err);
  }
}
