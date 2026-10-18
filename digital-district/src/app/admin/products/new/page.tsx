import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { quickCreateProductAction } from "@/app/admin/_actions/products";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Add product" };

export default async function NewProductPage() {
  await requireStaffPage("products.manage");
  const categories = await db.category.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
  return (
    <div className="max-w-3xl">
      <PageHeader back={{ href: "/admin/products", label: "Products" }} title="Add a product" description="Fill in the basics — you can add more options, photos, delivery details and SEO on the next screen." />
      <Panel>
        <ActionForm action={quickCreateProductAction} submitLabel="Create product" pendingLabel="Creating…">
          <Field label="Product name" htmlFor="title" required><Input id="title" name="title" required placeholder="e.g. Netflix Premium, Logitech G502 Mouse" /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="What are you selling?" htmlFor="type" required>
              <Select id="type" name="type" defaultValue="SUBSCRIPTION">
                <option value="SUBSCRIPTION">Subscription (e.g. Netflix, ChatGPT)</option>
                <option value="LICENSE">Licence or activation key</option>
                <option value="DIGITAL">Digital product / gift card / download</option>
                <option value="SERVICE">Service</option>
                <option value="PHYSICAL">Physical product (shipped)</option>
              </Select>
            </Field>
            <Field label="Category" htmlFor="categoryId">
              <Select id="categoryId" name="categoryId" defaultValue=""><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>)}</Select>
            </Field>
            <Field label="Selling price (USD)" htmlFor="price" required><Input id="price" name="price" inputMode="decimal" required placeholder="14.00" /></Field>
            <Field label="Your cost (USD)" htmlFor="cost" hint="Used for profit reports. Never shown to customers."><Input id="cost" name="cost" inputMode="decimal" placeholder="9.00" /></Field>
            <Field label="Stock quantity" htmlFor="stock" hint="Physical products only. Digital services aren't limited by stock."><Input id="stock" name="stock" inputMode="numeric" placeholder="e.g. 10" /></Field>
          </div>
          <Field label="Short description" htmlFor="shortDescription" hint="One line shown on product cards"><Input id="shortDescription" name="shortDescription" maxLength={200} /></Field>
          <Field label="Full description" htmlFor="description" hint="Tip: start a line with ## for a heading, - for a bullet point, and wrap words in **double stars** for bold."><Textarea id="description" name="description" className="min-h-32" /></Field>
          <Field label="Photos" htmlFor="images" hint="JPG, PNG or WebP. You can add more and reorder them later."><Input id="images" name="images" type="file" multiple accept="image/*" className="h-auto py-2" /></Field>
          <Checkbox name="publish" label="Publish now (otherwise it is saved as a draft that customers can't see)" />
        </ActionForm>
      </Panel>
    </div>
  );
}
