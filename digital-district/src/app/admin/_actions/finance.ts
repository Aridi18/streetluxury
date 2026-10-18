"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { toActionError, type ActionResult } from "@/lib/errors";
import { parseMoney } from "@/lib/money";
import { audit } from "@/lib/audit";

const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

export async function saveExpenseAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("expenses.manage");
    const amount = parseMoney(s(f, "amount"));
    if (!amount) return { ok: false, error: "Enter the amount." };
    if (!s(f, "description")) return { ok: false, error: "Describe the expense." };
    const date = s(f, "incurredAt");
    const e = await db.expense.create({
      data: { categoryId: s(f, "categoryId"), amount, incurredAt: date ? new Date(`${date}T12:00:00Z`) : new Date(), description: s(f, "description"), vendor: s(f, "vendor") || null, createdById: user.id },
      include: { category: true },
    });
    await audit(user, "expense.create", "Expense", e.id, `${e.category.name}: ${amount / 100} — ${e.description}`);
    revalidatePath("/admin/expenses");
    return { ok: true, message: "Expense recorded." };
  } catch (err) {
    return toActionError(err);
  }
}

export async function deleteExpenseAction(f: FormData) {
  const user = await requireStaff("expenses.manage");
  const e = await db.expense.delete({ where: { id: s(f, "id") }, include: { category: true } });
  await audit(user, "expense.delete", "Expense", e.id, `Deleted ${e.category.name}: ${e.amount / 100} — ${e.description}`, { amount: e.amount, incurredAt: e.incurredAt.toISOString(), description: e.description });
  revalidatePath("/admin/expenses");
}

export async function saveExpenseCategoryAction(_p: ActionResult | null, f: FormData): Promise<ActionResult> {
  try {
    const user = await requireStaff("expenses.manage");
    if (!s(f, "name")) return { ok: false, error: "Enter a name." };
    const c = await db.expenseCategory.create({ data: { name: s(f, "name"), isOperating: s(f, "kind") !== "other" } });
    await audit(user, "expense_category.create", "ExpenseCategory", c.id, `Added expense category ${c.name}`);
    revalidatePath("/admin/expenses");
    return { ok: true, message: "Category added." };
  } catch (err) {
    return toActionError(err);
  }
}
