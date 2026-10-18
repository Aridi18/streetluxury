import type { Metadata } from "next";
import Link from "next/link";
import { requireStaffPage } from "@/lib/auth";
import { importProductsAction } from "@/app/admin/_actions/products";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Field, Input, Select, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Import products" };

export default async function ImportPage() {
  await requireStaffPage("products.manage");
  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader back={{ href: "/admin/products", label: "Products" }} title="Import products from CSV" description="Add or update many products at once." />
      <Panel title="How it works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted">
          <li><a href="/api/admin/export/products" className="text-brand-300 underline">Export your products</a> to get a file in the right format (open it in Excel or Google Sheets).</li>
          <li>One row per option. Rows with the same <code>product_slug</code> belong to the same product. Leave <code>product_slug</code> empty for new products.</li>
          <li>Required columns: <code>title</code>, <code>type</code> (PHYSICAL, DIGITAL, SUBSCRIPTION, LICENSE or SERVICE) and <code>price</code>. Prices are in USD, like 14 or 9.50.</li>
          <li>Rows with an existing <code>sku</code> update that option; stock changes are recorded in the inventory history.</li>
          <li>First run a <strong>check</strong>: nothing is changed until the file has no errors and you choose <strong>Import now</strong>.</li>
        </ol>
      </Panel>
      <Panel>
        <ActionForm action={importProductsAction} submitLabel="Run" pendingLabel="Processing…">
          <Field label="CSV file" htmlFor="file"><Input id="file" name="file" type="file" accept=".csv,text/csv" required className="h-auto py-2" /></Field>
          <Field label="Mode" htmlFor="mode"><Select id="mode" name="mode" defaultValue="check"><option value="check">Check the file only (no changes)</option><option value="import">Import now</option></Select></Field>
        </ActionForm>
      </Panel>
      <Link href="/admin/products" className={buttonClass("ghost", "sm")}>Back to products</Link>
    </div>
  );
}
