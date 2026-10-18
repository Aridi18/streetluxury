"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { adjustStock, receivePurchase } from "@/lib/inventory";
import { audit } from "@/lib/audit";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function adjustStockAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("inventory.manage");
    const reason = s(f, "reason") as "MANUAL_ADJUSTMENT" | "STOCK_COUNT" | "DAMAGED";
    await adjustStock(user, { variantId: s(f, "variantId"), mode: reason === "STOCK_COUNT" ? "set" : "delta", value: Number(s(f, "value")), reason, note: s(f, "note") });
    revalidatePath("/admin/inventory");
    revalidatePath("/", "layout");
    return { ok: true, message: "Stock updated." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function saveSupplierAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("inventory.manage");
    const id = s(f, "id") || undefined;
    if (!s(f, "name")) return { ok: false, error: "Enter the supplier name." };
    const data = { name: s(f, "name"), contact: s(f, "contact") || null, phone: s(f, "phone") || null, email: s(f, "email") || null, notes: s(f, "notes") || null, isActive: f.get("isActive") !== "off" };
    const sup = id ? await db.supplier.update({ where: { id }, data }) : await db.supplier.create({ data });
    await audit(user, "supplier.save", "Supplier", sup.id, `Saved supplier ${sup.name}`);
    revalidatePath("/admin/purchases");
    return { ok: true, message: "Supplier saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function createPurchaseAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("inventory.manage");
    const rows = JSON.parse(s(f, "itemsJson") || "[]") as { variantId: string; quantity: string; unitCost: string }[];
    const items = rows
      .filter((r) => r.variantId)
      .map((r, i) => {
        const unitCost = parseMoney(r.unitCost);
        if (unitCost == null) throw new Error(`Line ${i + 1}: enter the unit cost.`);
        return { variantId: r.variantId, quantity: Number(r.quantity), unitCost };
      });
    const shipping = s(f, "shippingCost") ? parseMoney(s(f, "shippingCost")) : 0;
    const other = s(f, "otherCosts") ? parseMoney(s(f, "otherCosts")) : 0;
    if (shipping == null || other == null) return { ok: false, error: "Enter valid extra costs." };
    const date = s(f, "purchasedAt");
    await receivePurchase(user, {
      supplierId: s(f, "supplierId") || null,
      reference: s(f, "reference") || null,
      purchasedAt: date ? new Date(`${date}T12:00:00Z`) : new Date(),
      shippingCost: shipping,
      otherCosts: other,
      notes: s(f, "notes") || null,
      items,
    });
    revalidatePath("/admin/purchases");
    revalidatePath("/admin/inventory");
    revalidatePath("/", "layout");
    return { ok: true, message: "Purchase recorded: stock and average costs updated." };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Line ")) return { ok: false, error: err.message };
    return toActionError(err);
  }
}
