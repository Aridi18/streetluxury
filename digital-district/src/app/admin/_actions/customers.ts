"use server";

import { revalidatePath } from "next/cache";
import type { ReviewStatus, SupportStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { sendPasswordReset } from "@/lib/accounts";
import { anonymizeCustomer } from "@/lib/privacy";
import { syncRating } from "@/lib/catalog-sync";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function addCustomerNoteAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("customers.manage");
    if (!s(f, "body")) return { ok: false, error: "Write a note." };
    await db.customerNote.create({ data: { customerId: s(f, "customerId"), authorId: user.id, body: s(f, "body").slice(0, 5000) } });
    revalidatePath(`/admin/customers/${s(f, "customerId")}`);
    return { ok: true, message: "Note saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function setCustomerTagsAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("customers.manage");
    const tags = [...new Set(s(f, "tags").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 20);
    await db.user.update({ where: { id: s(f, "customerId") }, data: { customerTags: tags } });
    await audit(user, "customer.tags", "User", s(f, "customerId"), `Segments: ${tags.join(", ") || "none"}`);
    revalidatePath(`/admin/customers/${s(f, "customerId")}`);
    return { ok: true, message: "Segments saved." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function resetLinkAction(_p: ActionResult<{ url: string }> | null, f: FormData): Promise<ActionResult<{ url: string }>> {
  try {
    const user = await requireStaff("customers.manage");
    const customer = await db.user.findUniqueOrThrow({ where: { id: s(f, "customerId") } });
    if (customer.role !== "CUSTOMER") return { ok: false, error: "Use Staff & roles for staff accounts." };
    const url = await sendPasswordReset(customer);
    await audit(user, "customer.reset_link", "User", customer.id, "Created a password reset link");
    return { ok: true, data: { url }, message: `Reset link (valid for 1 hour) — send it to the customer privately, e.g. on WhatsApp:\n${url}` };
  } catch (err) {
    return toActionError(err);
  }
}

export async function anonymizeCustomerAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("customers.export");
    if (s(f, "confirm") !== "DELETE") return { ok: false, error: "Type DELETE to confirm." };
    await anonymizeCustomer(user, s(f, "customerId"));
    revalidatePath("/admin/customers");
    return { ok: true, message: "The customer's personal data has been deleted." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function moderateReviewAction(f: FormData) {
  const user = await requireStaff("reviews.moderate");
  const review = await db.review.update({ where: { id: s(f, "id") }, data: { status: s(f, "status") as ReviewStatus } });
  await syncRating(review.productId);
  await audit(user, "review.moderate", "Review", review.id, `${s(f, "status")} review (${review.rating}★)`);
  revalidatePath("/admin/reviews");
  revalidatePath("/", "layout");
}

export async function updateSupportAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("support.manage");
    await db.supportRequest.update({ where: { id: s(f, "id") }, data: { status: s(f, "status") as SupportStatus, resolution: s(f, "resolution") || null } });
    await audit(user, "support.update", "SupportRequest", s(f, "id"), `Status ${s(f, "status")}`);
    revalidatePath(`/admin/support/${s(f, "id")}`);
    revalidatePath("/admin/support");
    return { ok: true, message: "Request updated." };
  } catch (err) {
    return toActionError(err);
  }
}
