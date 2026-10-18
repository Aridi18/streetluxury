import type { Metadata } from "next";
import type { Category } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { imageUrl } from "@/lib/media";
import { saveCategoryAction, deleteCategoryAction } from "@/app/admin/_actions/catalog";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { CATEGORY_ICON_NAMES, CategoryIcon } from "@/components/store/icons";
import { Badge, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Categories" };

function CategoryFields({ c, all }: { c?: Category; all: Category[] }) {
  const key = c?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {c && <input type="hidden" name="id" value={c.id} />}
      <Field label="Name" htmlFor={`n-${key}`} required><Input id={`n-${key}`} name="name" required defaultValue={c?.name} /></Field>
      <Field label="Web address" htmlFor={`s-${key}`} hint="Leave empty to create from the name"><Input id={`s-${key}`} name="slug" defaultValue={c?.slug} /></Field>
      <Field label="Parent category" htmlFor={`p-${key}`}>
        <Select id={`p-${key}`} name="parentId" defaultValue={c?.parentId ?? ""}><option value="">None (top level)</option>{all.filter((x) => x.id !== c?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
      </Field>
      <Field label="Icon" htmlFor={`i-${key}`}>
        <Select id={`i-${key}`} name="icon" defaultValue={c?.icon ?? ""}><option value="">Default</option>{CATEGORY_ICON_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}</Select>
      </Field>
      <Field label="Description" htmlFor={`d-${key}`} className="md:col-span-2"><Textarea id={`d-${key}`} name="description" defaultValue={c?.description ?? ""} className="min-h-16" /></Field>
      <Field label="Display order" htmlFor={`o-${key}`} hint="Lower numbers appear first"><Input id={`o-${key}`} name="sortOrder" inputMode="numeric" defaultValue={c?.sortOrder ?? 0} /></Field>
      <Field label="Image (optional)" htmlFor={`im-${key}`}><Input id={`im-${key}`} name="image" type="file" accept="image/*" className="h-auto py-2 text-sm" /></Field>
      <Field label="SEO title" htmlFor={`st-${key}`}><Input id={`st-${key}`} name="seoTitle" defaultValue={c?.seoTitle ?? ""} /></Field>
      <Field label="SEO description" htmlFor={`sd-${key}`}><Input id={`sd-${key}`} name="seoDescription" defaultValue={c?.seoDescription ?? ""} /></Field>
      <Checkbox name="isVisible" defaultChecked={c ? c.isVisible : true} label="Visible in the store" className="md:col-span-2" />
    </div>
  );
}

export default async function CategoriesPage() {
  await requireStaffPage("products.manage");
  const [categories, counts] = await Promise.all([
    db.category.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.product.groupBy({ by: ["categoryId"], where: { deletedAt: null }, _count: true }),
  ]);
  const countOf = new Map(counts.map((c) => [c.categoryId, c._count]));
  const ordered: { c: Category; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => categories.filter((c) => c.parentId === parentId).forEach((c) => { ordered.push({ c, depth }); walk(c.id, depth + 1); });
  walk(null, 0);
  return (
    <div className="max-w-5xl">
      <PageHeader title="Categories" description="Categories with no active products are automatically left out of the store menu." />
      <Panel title="Add a category" className="mb-6"><ActionForm action={saveCategoryAction} submitLabel="Add category" resetOnSuccess><CategoryFields all={categories} /></ActionForm></Panel>
      <div className="space-y-2">
        {ordered.map(({ c, depth }) => (
          <details key={c.id} className="rounded-2xl border border-line bg-surface" style={{ marginLeft: depth * 24 }}>
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="grid size-9 place-items-center overflow-hidden rounded-lg bg-brand-500/10 text-brand-300">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {c.imageKey ? <img src={imageUrl(c.imageKey, 400)!} alt="" className="size-full object-cover" /> : <CategoryIcon name={c.icon} className="size-4" />}
              </span>
              <span className="flex-1"><span className="font-semibold text-white">{c.name}</span> <span className="text-xs text-subtle">/{c.slug}</span></span>
              <span className="text-xs text-muted">{countOf.get(c.id) ?? 0} products</span>
              {!c.isVisible && <Badge>Hidden</Badge>}
              <span className="text-xs text-brand-300">Edit</span>
            </summary>
            <div className="space-y-4 border-t border-line p-4">
              <ActionForm action={saveCategoryAction} submitLabel="Save"><CategoryFields c={c} all={categories} /></ActionForm>
              <ActionForm action={deleteCategoryAction} submitLabel="Delete category" submitVariant="danger"><input type="hidden" name="id" value={c.id} /></ActionForm>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
