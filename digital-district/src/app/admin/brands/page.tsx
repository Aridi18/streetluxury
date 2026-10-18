import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { deleteCollectionAction, saveBrandAction, saveCollectionAction } from "@/app/admin/_actions/catalog";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Badge, Button, Checkbox, Field, Input, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Brands & collections" };

export default async function BrandsPage() {
  await requireStaffPage("products.manage");
  const [brands, collections, products] = await Promise.all([
    db.brand.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { products: true } } } }),
    db.collection.findMany({ orderBy: { sortOrder: "asc" }, include: { products: { orderBy: { sortOrder: "asc" } } } }),
    db.product.findMany({ where: { deletedAt: null, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
  ]);
  const productPicker = (selected: string[], key: string) => (
    <Field label="Products (hold Ctrl / Cmd to pick several)" htmlFor={`cp-${key}`} className="md:col-span-2">
      <select id={`cp-${key}`} name="productIds" multiple defaultValue={selected} className="h-48 w-full rounded-xl border border-line-strong bg-surface-2 p-2 text-sm">
        {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
    </Field>
  );
  return (
    <div className="grid max-w-6xl gap-8 xl:grid-cols-2">
      <div>
        <PageHeader title="Featured collections" description="Hand-picked groups of products, e.g. “Back to school” or “Gaming setup”. Can be shown on the homepage." />
        <Panel title="New collection" className="mb-4">
          <ActionForm action={saveCollectionAction} submitLabel="Create collection" resetOnSuccess>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" htmlFor="c-name" required><Input id="c-name" name="name" required /></Field>
              <Field label="Display order" htmlFor="c-order"><Input id="c-order" name="sortOrder" inputMode="numeric" defaultValue={0} /></Field>
              <Field label="Description" htmlFor="c-desc" className="md:col-span-2"><Textarea id="c-desc" name="description" className="min-h-16" /></Field>
              {productPicker([], "new")}
              <Checkbox name="isVisible" defaultChecked label="Visible" /><Checkbox name="showOnHome" label="Show on homepage" />
            </div>
          </ActionForm>
        </Panel>
        <div className="space-y-2">
          {collections.map((c) => (
            <details key={c.id} className="rounded-2xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
                <span className="font-semibold text-white">{c.name}</span>
                <span className="flex items-center gap-2 text-xs text-muted">{c.products.length} products {c.showOnHome && <Badge tone="accent">Homepage</Badge>} {!c.isVisible && <Badge>Hidden</Badge>}</span>
              </summary>
              <div className="space-y-3 border-t border-line p-4">
                <ActionForm action={saveCollectionAction} submitLabel="Save">
                  <input type="hidden" name="id" value={c.id} />
                  <div className="grid gap-3 md:grid-cols-2">
                    <Field label="Name" htmlFor={`cn-${c.id}`}><Input id={`cn-${c.id}`} name="name" defaultValue={c.name} required /></Field>
                    <Field label="Display order" htmlFor={`co-${c.id}`}><Input id={`co-${c.id}`} name="sortOrder" defaultValue={c.sortOrder} /></Field>
                    <Field label="Description" htmlFor={`cd-${c.id}`} className="md:col-span-2"><Textarea id={`cd-${c.id}`} name="description" defaultValue={c.description ?? ""} className="min-h-16" /></Field>
                    {productPicker(c.products.map((p) => p.productId), c.id)}
                    <Checkbox name="isVisible" defaultChecked={c.isVisible} label="Visible" /><Checkbox name="showOnHome" defaultChecked={c.showOnHome} label="Show on homepage" />
                  </div>
                </ActionForm>
                <form action={deleteCollectionAction}><input type="hidden" name="id" value={c.id} /><Button size="sm" variant="danger">Delete collection</Button></form>
              </div>
            </details>
          ))}
        </div>
      </div>
      <div>
        <PageHeader title="Brands" description="Brands power the brand filter and brand pages." />
        <Panel title="New brand" className="mb-4">
          <ActionForm action={saveBrandAction} submitLabel="Add brand" resetOnSuccess>
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name" htmlFor="b-name" required><Input id="b-name" name="name" required /></Field>
              <Field label="Website" htmlFor="b-web"><Input id="b-web" name="website" type="url" /></Field>
            </div>
            <Checkbox name="isVisible" defaultChecked label="Visible" />
          </ActionForm>
        </Panel>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {brands.map((b) => (
            <li key={b.id}>
              <details>
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm"><span>{b.name}</span><span className="text-xs text-subtle">{b._count.products} products{!b.isVisible ? " · hidden" : ""}</span></summary>
                <div className="border-t border-line p-4">
                  <ActionForm action={saveBrandAction} submitLabel="Save">
                    <input type="hidden" name="id" value={b.id} />
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Name" htmlFor={`bn-${b.id}`}><Input id={`bn-${b.id}`} name="name" defaultValue={b.name} required /></Field>
                      <Field label="Website" htmlFor={`bw-${b.id}`}><Input id={`bw-${b.id}`} name="website" defaultValue={b.website ?? ""} /></Field>
                    </div>
                    <Checkbox name="isVisible" defaultChecked={b.isVisible} label="Visible" />
                  </ActionForm>
                </div>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
