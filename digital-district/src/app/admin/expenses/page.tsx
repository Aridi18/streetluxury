import type { Metadata } from "next";
import { Download, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { resolvePeriod, zonedYmd, type PeriodPreset } from "@/lib/time";
import { deleteExpenseAction, saveExpenseAction, saveExpenseCategoryAction } from "@/app/admin/_actions/finance";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, Table, fmtDate } from "@/components/admin/ui";
import { PeriodPicker } from "@/components/admin/period-picker";
import { Badge, Field, Input, Select, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Expenses" };

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ period?: PeriodPreset; from?: string; to?: string }> }) {
  await requireStaffPage("expenses.manage");
  const sp = await searchParams;
  const p = resolvePeriod(sp.period ?? "month", sp.from, sp.to);
  const [categories, expenses] = await Promise.all([
    db.expenseCategory.findMany({ orderBy: [{ isOperating: "desc" }, { name: "asc" }] }),
    db.expense.findMany({ where: { incurredAt: { gte: p.from, lt: p.to } }, orderBy: { incurredAt: "desc" }, include: { category: true } }),
  ]);
  const total = expenses.reduce((s, e) => s + e.amount, 0);
  return (
    <div>
      <PageHeader title="Expenses" description="Record what the business spends so profit reports are complete. Stock purchases belong in Suppliers & purchases, not here." actions={<><PeriodPicker period={p} basePath="/admin/expenses" /><a href={`/api/admin/export/expenses?period=${p.preset}${p.preset === "custom" ? `&from=${p.fromYmd}&to=${p.toYmd}` : ""}`} className={buttonClass("secondary", "sm")}><Download className="size-4" /> CSV</a></>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div>
          <Table>
            <thead><tr><th>Date</th><th>Category</th><th>Description</th><th className="text-right">Amount</th><th></th></tr></thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id}>
                  <td className="text-muted">{fmtDate(e.incurredAt)}</td>
                  <td>{e.category.name} {!e.category.isOperating && <Badge>other</Badge>}</td>
                  <td>{e.description}{e.vendor && <p className="text-xs text-subtle">{e.vendor}</p>}</td>
                  <td className="text-right font-semibold">{formatMoney(e.amount)}</td>
                  <td className="text-right"><form action={deleteExpenseAction}><input type="hidden" name="id" value={e.id} /><button className="p-1 text-subtle hover:text-danger" aria-label="Delete expense"><Trash2 className="size-4" /></button></form></td>
                </tr>
              ))}
              {!expenses.length && <tr><td colSpan={5} className="py-8 text-center text-subtle">No expenses in this period.</td></tr>}
            </tbody>
            {expenses.length > 0 && <tfoot><tr className="border-t border-line font-semibold"><td colSpan={3} className="px-4 py-3">Total ({p.label})</td><td className="px-4 py-3 text-right">{formatMoney(total)}</td><td /></tr></tfoot>}
          </Table>
        </div>
        <div className="space-y-6">
          <Panel title="Add an expense">
            <ActionForm action={saveExpenseAction} submitLabel="Add expense" resetOnSuccess>
              <Field label="Category" htmlFor="ex-cat"><Select id="ex-cat" name="categoryId" required>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
              <Field label="Amount (USD)" htmlFor="ex-amt" required><Input id="ex-amt" name="amount" inputMode="decimal" required /></Field>
              <Field label="Date" htmlFor="ex-date"><Input id="ex-date" name="incurredAt" type="date" defaultValue={zonedYmd(new Date())} className="[color-scheme:dark]" /></Field>
              <Field label="Description" htmlFor="ex-desc" required><Input id="ex-desc" name="description" required placeholder="e.g. Instagram ads — October" /></Field>
              <Field label="Paid to (optional)" htmlFor="ex-vendor"><Input id="ex-vendor" name="vendor" /></Field>
            </ActionForm>
          </Panel>
          <Panel title="Expense categories">
            <ul className="mb-4 space-y-1 text-sm">{categories.map((c) => <li key={c.id} className="flex justify-between"><span>{c.name}</span><span className="text-xs text-subtle">{c.isOperating ? "operating" : "other"}</span></li>)}</ul>
            <ActionForm action={saveExpenseCategoryAction} submitLabel="Add category" submitVariant="secondary" resetOnSuccess>
              <Input name="name" required placeholder="New category" aria-label="Category name" />
              <Select name="kind" aria-label="Type"><option value="operating">Operating expense (running the business)</option><option value="other">Other expense (below operating profit, e.g. interest, taxes)</option></Select>
            </ActionForm>
          </Panel>
        </div>
      </div>
    </div>
  );
}
