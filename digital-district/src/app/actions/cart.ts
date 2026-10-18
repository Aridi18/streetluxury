"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addToCart, removeCartItem, setCartCoupon, setSavedForLater, updateCartItem, findCouponRule } from "@/lib/cart";
import { toActionError, type ActionResult } from "@/lib/errors";
import { rateLimit } from "@/lib/ratelimit";
import { clientInfo } from "@/lib/auth";

function customFieldsFrom(formData: FormData) {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (k.startsWith("cf_") && typeof v === "string") out[k.slice(3)] = v;
  return out;
}

export async function addToCartAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { ip } = await clientInfo();
    await rateLimit(`cart:${ip}`, 120, 60);
    await addToCart({
      variantId: String(formData.get("variantId") ?? ""),
      quantity: Number(formData.get("quantity") ?? 1),
      customFields: customFieldsFrom(formData),
      note: String(formData.get("note") ?? ""),
    });
    revalidatePath("/", "layout");
    if (formData.get("intent") === "buy") redirect("/checkout");
    return { ok: true, message: "Added to your cart." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function updateQuantityAction(formData: FormData) {
  try {
    await updateCartItem(String(formData.get("itemId")), Number(formData.get("quantity")));
  } catch (err) {
    const r = toActionError(err);
    redirect(`/cart?error=${encodeURIComponent(r.error)}`);
  }
  revalidatePath("/", "layout");
}

export async function removeItemAction(formData: FormData) {
  try {
    await removeCartItem(String(formData.get("itemId")));
  } catch {
    // Already gone.
  }
  revalidatePath("/", "layout");
}

export async function saveForLaterAction(formData: FormData) {
  try {
    await setSavedForLater(String(formData.get("itemId")), formData.get("saved") === "1");
  } catch {
    // Already gone.
  }
  revalidatePath("/", "layout");
}

export async function applyCouponAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const { ip } = await clientInfo();
    await rateLimit(`coupon:${ip}`, 20, 600);
    const code = String(formData.get("code") ?? "").trim();
    if (!code) return { ok: false, error: "Enter a discount code." };
    const rule = await findCouponRule(code);
    if (rule === "invalid" || !rule) return { ok: false, error: "This code is not valid." };
    await setCartCoupon(code);
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (err) {
    return toActionError(err);
  }
}

export async function removeCouponAction() {
  await setCartCoupon(null);
  revalidatePath("/", "layout");
}
