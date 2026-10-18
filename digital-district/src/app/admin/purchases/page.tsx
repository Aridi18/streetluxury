import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney, centsToInput } from "@/lib/money";
import { zonedYmd } from "@/lib/time";
import { createPurchaseAction, saveSupplierAction } from "@/app/admin/_actions/inventory";
import { ActionForm } from "@/components/action-form";
import { PurchaseItemsEditor } from "@/components/admin/purchase-items";
import { PageHeader, Panel, Table, fmtDate } from "@/components/admin/ui";
import { Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Suppliers & purchases" };

export default async function PurchasesPage() {
  await requireStaffPage("inventory.manage");
  const [suppliers, purchases, variants] = await Promise.all([
    db.supplier.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { purchases: true } } } }),
    db.purchase.findMany({ orderBy: { purchasedAt: "desc" }, take: 50, include: { supplier: true, items: { include: { variant: { include: { product: { select: { title: true } } } } } } } }),
    db.productVariant.findMany({ where: { deletedAt: null, product: { deletedAt: null } }, include: { product: { select: { title: true } } }, orderBy: [{ product: { title: "asc" } }, { sortOrder: "asc" }] }),
  ]);
  return (
    <div className="space-y-8">
      <PageHeader title="Suppliers & purchases" description="Record stock you buy. Stock increases and each item's cost is updated with the weighted-average method, so profit reports stay accurate." />
      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="Record a purchase">
          <ActionForm action={createPurchaseAction} submitLabel="Record purchase & add stock" resetOnSuccess>
            <div className="grid gap-3 md:grid-cols-3">
              <Field label="Supplier" htmlFor="pu-sup"><Select id="pu-sup" name="supplierId" defaultValue=""><option value="">—</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
              <Field label="Date" htmlFor="pu-date"><Input id="pu-date" name="purchasedAt" type="date" defaultValue={zonedYmd(new Date())} className="[color-scheme:dark]" /></Field>
              <Field label="Invoice / reference" htmlFor="pu-ref"><Input id="pu-ref" name="reference" /></Field>
            </div>
            <PurchaseItemsEditor variants={variants.map((v) => ({ id: v.id, label: `${v.product.title}${v.name !== "Default" ? ` — ${v.name}` : ""} (${v.sku})`, cost: v.costPrice ? centsToInput(v.costPrice) : "" }))} />
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Shipping / import cost (USD)" htmlFor="pu-ship" hint="Spread over the items by value"><Input id="pu-ship" name="shippingCost" inputMode="decimal" /></Field>
              <Field label="Other costs (USD)" htmlFor="pu-other" hint="Customs, fees…"><Input id="pu-other" name="otherCosts" inputMode="decimal" /></Field>
            </div>
            <Field label="Notes" htmlFor="pu-notes"><Textarea id="pu-notes" name="notes" className="min-h-16" /></Field>
          </ActionForm>
        </Panel>
        <Panel title="Suppliers">
          <ActionForm action={saveSupplierAction} submitLabel="Add supplier" submitVariant="secondary" resetOnSuccess>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" htmlFor="su-name" required><Input id="su-name" name="name" required /></Field>
              <Field label="Contact person" htmlFor="su-contact"><Input id="su-contact" name="contact" /></Field>
              <Field label="Phone" htmlFor="su-phone"><Input id="su-phone" name="phone" /></Field>
              <Field label="Email" htmlFor="su-email"><Input id="su-email" name="email" type="email" /></Field>
            </div>
            <Field label="Notes" htmlFor="su-notes"><Textarea id="su-notes" name="notes" className="min-h-16" /></Field>
          </ActionForm>
          <ul className="mt-4 divide-y divide-line text-sm">
            {suppliers.map((s) => <li key={s.id} className="flex justify-between py-2"><span>{s.name}{s.phone ? <span className="text-subtle"> · {s.phone}</span> : null}</span><span className="text-xs text-subtle">{s._count.purchases} purchases</span></li>)}
          </ul>
        </Panel>
      </div>
      <div>
        <h2 className="mb-3 font-semibold">Purchase history</h2>
        <Table>
          <thead><tr><th>Date</th><th>Supplier</th><th>Items</th><th className="text-right">Extra costs</th><th className="text-right">Total</th></tr></thead>
          <tbody>
            {purchases.map((p) => (
              <tr key={p.id}>
                <td>{fmtDate(p.purchasedAt)}{p.reference && <p className="text-xs text-subtle">{p.reference}</p>}</td>
                <td>{p.supplier?.name ?? "—"}</td>
                <td className="text-xs text-muted">{p.items.map((i) => `${i.quantity}× ${i.variant.product.title}${i.variant.name !== "Default" ? ` (${i.variant.name})` : ""} @ ${formatMoney(i.unitCost)}`).join(", ")}</td>
                <td className="text-right">{formatMoney(p.shippingCost + p.otherCosts)}</td>
                <td className="text-right font-semibold">{formatMoney(p.total)}</td>
              </tr>
            ))}
            {!purchases.length && <tr><td colSpan={5} className="py-8 text-center text-subtle">No purchases recorded yet.</td></tr>}
          </tbody>
        </Table>
      </div>
    </div>
  );
}
