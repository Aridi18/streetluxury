import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, ExternalLink, Star, Trash2 } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { centsToInput } from "@/lib/money";
import { parseCustomFieldDefs } from "@/lib/cart";
import { addLicenseKeysAction, deleteDigitalFileAction, deleteProductAction, duplicateProductAction, imageAction, saveProductAction, uploadDigitalFileAction, uploadImagesAction } from "@/app/admin/_actions/products";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { VariantEditor, CustomFieldsEditor, type VariantRow } from "@/components/admin/variant-editor";
import { ProductImage } from "@/components/store/product-image";
import { Alert, Badge, Button, Checkbox, Field, Input, Select, Textarea, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; duplicated?: string }> }) {
  await requireStaffPage("products.manage");
  const { id } = await params;
  const sp = await searchParams;
  const product = await db.product.findFirst({
    where: { id, deletedAt: null },
    include: {
      images: { orderBy: { sortOrder: "asc" } },
      variants: { where: { deletedAt: null }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { licenseKeys: { where: { status: "AVAILABLE" } } } } } },
      tags: { include: { tag: true } },
      digitalAssets: { where: { isActive: true }, orderBy: { createdAt: "asc" } },
      _count: { select: { orderItems: true } },
    },
  });
  if (!product) notFound();
  const [categories, brands] = await Promise.all([
    db.category.findMany({ where: { deletedAt: null }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.brand.findMany({ orderBy: { name: "asc" } }),
  ]);
  const optionNames = [...new Set(product.variants.flatMap((v) => Object.keys((v.optionValues ?? {}) as Record<string, string>)))];
  const rows: VariantRow[] = product.variants.map((v) => ({
    id: v.id,
    name: v.name,
    optionValues: (v.optionValues ?? {}) as Record<string, string>,
    sku: v.sku,
    price: centsToInput(v.price),
    compareAtPrice: centsToInput(v.compareAtPrice),
    costPrice: v.costPrice ? centsToInput(v.costPrice) : "",
    trackInventory: v.trackInventory,
    stock: v.stockOnHand,
    initialStock: "",
    allowBackorder: v.allowBackorder,
    lowStockThreshold: String(v.lowStockThreshold),
    durationDays: v.durationDays ? String(v.durationDays) : "",
    weightGrams: v.weightGrams ? String(v.weightGrams) : "",
    isActive: v.isActive,
  }));
  const specs = ((product.specifications ?? []) as { label: string; value: string }[]).map((x) => `${x.label}: ${x.value}`).join("\n");
  const customFields = parseCustomFieldDefs(product.customFields).map((c) => ({ label: c.label, type: c.type, required: c.required, options: c.options?.join(", ") ?? "" }));
  const digital = product.type !== "PHYSICAL";

  return (
    <div>
      <PageHeader
        back={{ href: "/admin/products", label: "Products" }}
        title={product.title}
        description={<span className="flex flex-wrap items-center gap-2"><Badge tone={product.status === "ACTIVE" ? "success" : "warning"}>{product.status.toLowerCase()}</Badge> {product._count.orderItems} order line{product._count.orderItems === 1 ? "" : "s"} · {product.salesCount} sold · {product.viewCount} views</span>}
        actions={
          <>
            {product.status === "ACTIVE" && <Link href={`/product/${product.slug}`} target="_blank" className={buttonClass("ghost", "sm")}>View in store <ExternalLink className="size-3.5" /></Link>}
            <form action={duplicateProductAction}><input type="hidden" name="id" value={product.id} /><Button size="sm" variant="secondary"><Copy className="size-4" /> Duplicate</Button></form>
          </>
        }
      />
      {sp.created && <Alert tone="success" className="mb-6">Product created. Add more details below, then save.</Alert>}
      {sp.duplicated && <Alert tone="success" className="mb-6">This is a copy saved as a draft. Rename it, adjust it and publish when ready.</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <ActionForm action={saveProductAction} submitLabel="Save product" className="space-y-6" submitClassName="sticky bottom-4 z-10 shadow-2xl">
          <input type="hidden" name="id" value={product.id} />
          <Panel title="Basics">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Name" htmlFor="title" required className="md:col-span-2"><Input id="title" name="title" required defaultValue={product.title} /></Field>
              <Field label="Web address" htmlFor="slug" hint={`digitaldistrict.store/product/${product.slug}`}><Input id="slug" name="slug" defaultValue={product.slug} /></Field>
              <Field label="Badge" htmlFor="badge" hint="Short label on the card, e.g. Best Seller, New"><Input id="badge" name="badge" defaultValue={product.badge ?? ""} maxLength={24} /></Field>
              <Field label="Type" htmlFor="type">
                <Select id="type" name="type" defaultValue={product.type}>
                  <option value="SUBSCRIPTION">Subscription</option><option value="LICENSE">Licence / key</option><option value="DIGITAL">Digital product</option><option value="SERVICE">Service</option><option value="PHYSICAL">Physical product</option>
                </Select>
              </Field>
              <Field label="Status" htmlFor="status" hint="Draft and hidden products are not visible in the store">
                <Select id="status" name="status" defaultValue={product.status}><option value="ACTIVE">Active (visible)</option><option value="DRAFT">Draft</option><option value="HIDDEN">Hidden</option><option value="ARCHIVED">Archived</option></Select>
              </Field>
              <Field label="Category" htmlFor="categoryId">
                <Select id="categoryId" name="categoryId" defaultValue={product.categoryId ?? ""}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.parentId ? "— " : ""}{c.name}</option>)}</Select>
              </Field>
              <Field label="Brand" htmlFor="brandId">
                <Select id="brandId" name="brandId" defaultValue={product.brandId ?? ""}><option value="">No brand</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>
              </Field>
              <Field label="…or add a new brand" htmlFor="newBrand"><Input id="newBrand" name="newBrand" placeholder="Brand name" /></Field>
              <Field label="Tags" htmlFor="tags" hint="Comma separated — helps search"><Input id="tags" name="tags" defaultValue={product.tags.map((t) => t.tag.name).join(", ")} /></Field>
              <Field label="Short description" htmlFor="shortDescription" className="md:col-span-2"><Input id="shortDescription" name="shortDescription" defaultValue={product.shortDescription ?? ""} maxLength={200} /></Field>
              <Field label="Description" htmlFor="description" className="md:col-span-2" hint="## Heading · - bullet · **bold** · [link](https://…)"><Textarea id="description" name="description" defaultValue={product.description ?? ""} className="min-h-40" /></Field>
              <Field label="Specifications" htmlFor="specifications" className="md:col-span-2" hint="One per line, as Label: Value — e.g. Storage: 256 GB"><Textarea id="specifications" name="specifications" defaultValue={specs} className="min-h-24 font-mono text-sm" /></Field>
              <div className="flex flex-wrap gap-x-6 gap-y-2 md:col-span-2">
                <Checkbox name="isFeatured" defaultChecked={product.isFeatured} label="Featured on homepage" />
                <Checkbox name="isBestseller" defaultChecked={product.isBestseller} label="Mark as bestseller" />
                <Checkbox name="isOnRequest" defaultChecked={product.isOnRequest} label="Price on request (WhatsApp quote only)" />
              </div>
            </div>
          </Panel>

          <Panel title="Options, prices & stock">
            <VariantEditor initial={rows} initialOptionNames={optionNames} physical={product.type === "PHYSICAL"} />
          </Panel>

          <Panel title="Questions for the customer">
            <p className="mb-3 text-sm text-muted">Ask for what you need to deliver, e.g. the email to activate a subscription on.</p>
            <CustomFieldsEditor initial={customFields} />
            <Checkbox name="allowCustomerNote" defaultChecked={product.allowCustomerNote} label="Let customers add a free-text note" className="mt-3" />
          </Panel>

          <Panel title="Delivery">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Delivery method" htmlFor="deliveryMethod"><Input id="deliveryMethod" name="deliveryMethod" defaultValue={product.deliveryMethod ?? ""} placeholder={digital ? "Digital delivery on WhatsApp, email or your order page" : "Courier delivery across Lebanon"} /></Field>
              <Field label="Estimated delivery time" htmlFor="deliveryEstimate"><Input id="deliveryEstimate" name="deliveryEstimate" defaultValue={product.deliveryEstimate ?? ""} placeholder={digital ? "Within minutes after payment" : "1–3 working days"} /></Field>
              {digital && (
                <Field label="Digital delivery" htmlFor="digitalDeliveryMode" hint="Automatic works with licence keys or files added below" className="md:col-span-2">
                  <Select id="digitalDeliveryMode" name="digitalDeliveryMode" defaultValue={product.digitalDeliveryMode}><option value="MANUAL">Manual — our team delivers after payment</option><option value="AUTOMATIC">Automatic — keys / files released when payment is confirmed</option></Select>
                </Field>
              )}
              <Field label="How delivery works (shown before purchase)" htmlFor="deliveryInstructions" className="md:col-span-2"><Textarea id="deliveryInstructions" name="deliveryInstructions" defaultValue={product.deliveryInstructions ?? ""} /></Field>
              {digital && <Field label="Activation instructions (shown only to buyers after delivery)" htmlFor="activationInstructions" className="md:col-span-2"><Textarea id="activationInstructions" name="activationInstructions" defaultValue={product.activationInstructions ?? ""} /></Field>}
              {!digital && (
                <>
                  <Field label="Extra delivery fee per unit (USD)" htmlFor="shippingSurcharge" hint="Added to the area's delivery fee, e.g. for bulky items"><Input id="shippingSurcharge" name="shippingSurcharge" inputMode="decimal" defaultValue={centsToInput(product.shippingSurcharge)} /></Field>
                  <div className="flex items-end pb-2"><Checkbox name="freeShipping" defaultChecked={product.freeShipping} label="Always free delivery for this product" /></div>
                </>
              )}
            </div>
          </Panel>

          <Panel title="Warranty, returns & terms">
            <div className="grid gap-4">
              <Field label="Warranty" htmlFor="warranty"><Textarea id="warranty" name="warranty" defaultValue={product.warranty ?? ""} className="min-h-16" /></Field>
              <Field label="Return policy" htmlFor="returnPolicy" hint="Leave empty to use the store refund policy"><Textarea id="returnPolicy" name="returnPolicy" defaultValue={product.returnPolicy ?? ""} className="min-h-16" /></Field>
              <Field label="Product terms" htmlFor="terms"><Textarea id="terms" name="terms" defaultValue={product.terms ?? ""} className="min-h-16" /></Field>
            </div>
          </Panel>

          <Panel title="Search engines & media">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="SEO title" htmlFor="seoTitle"><Input id="seoTitle" name="seoTitle" defaultValue={product.seoTitle ?? ""} maxLength={70} /></Field>
              <Field label="Sort order" htmlFor="sortOrder" hint="Lower numbers appear first"><Input id="sortOrder" name="sortOrder" inputMode="numeric" defaultValue={product.sortOrder} /></Field>
              <Field label="SEO description" htmlFor="seoDescription" className="md:col-span-2"><Textarea id="seoDescription" name="seoDescription" defaultValue={product.seoDescription ?? ""} maxLength={170} className="min-h-16" /></Field>
              <Field label="Video link" htmlFor="videoUrl" hint="YouTube, Vimeo or an https .mp4 link" className="md:col-span-2"><Input id="videoUrl" name="videoUrl" type="url" defaultValue={product.videoUrl ?? ""} /></Field>
            </div>
          </Panel>
        </ActionForm>

        <div className="space-y-6">
          <Panel title="Photos">
            <ul className="mb-4 grid grid-cols-2 gap-3">
              {product.images.map((img, i) => (
                <li key={img.id} className="overflow-hidden rounded-xl border border-line bg-surface-2">
                  <div className="relative aspect-square"><ProductImage imageKey={img.key} alt={img.alt ?? ""} title={product.title} sizes="160px" />{i === 0 && <span className="absolute left-2 top-2 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold">Main</span>}</div>
                  <form action={imageAction} className="flex items-center gap-1 p-1.5">
                    <input type="hidden" name="imageId" value={img.id} />
                    {i > 0 && <button name="op" value="first" className="rounded p-1 hover:bg-surface-3" aria-label="Make main photo"><Star className="size-3.5" /></button>}
                    <button name="op" value="up" disabled={i === 0} className="rounded p-1 hover:bg-surface-3 disabled:opacity-30" aria-label="Move earlier"><ArrowUp className="size-3.5" /></button>
                    <button name="op" value="down" disabled={i === product.images.length - 1} className="rounded p-1 hover:bg-surface-3 disabled:opacity-30" aria-label="Move later"><ArrowDown className="size-3.5" /></button>
                    <button name="op" value="delete" className="ml-auto rounded p-1 text-danger hover:bg-surface-3" aria-label="Delete photo"><Trash2 className="size-3.5" /></button>
                  </form>
                  <form action={imageAction} className="flex gap-1 px-1.5 pb-1.5">
                    <input type="hidden" name="imageId" value={img.id} /><input type="hidden" name="op" value="alt" />
                    <input name="alt" defaultValue={img.alt ?? ""} placeholder="Alt text" aria-label="Alt text" className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-xs" />
                    <button className="rounded-md bg-surface-3 px-2 text-xs">Save</button>
                  </form>
                </li>
              ))}
            </ul>
            <ActionForm action={uploadImagesAction} submitLabel="Upload photos" submitVariant="secondary" pendingLabel="Uploading…" resetOnSuccess>
              <input type="hidden" name="productId" value={product.id} />
              <Input name="images" type="file" multiple accept="image/*" required className="h-auto py-2 text-sm" aria-label="Photos" />
              <p className="text-xs text-subtle">Photos are resized and converted for fast loading. Use real product photos.</p>
            </ActionForm>
          </Panel>

          {digital && (
            <Panel title="Licence keys">
              <p className="mb-3 text-sm text-muted">Keys are encrypted and released one per unit when an order is paid (with automatic delivery on). Each key counts as one unit of stock.</p>
              <ul className="mb-3 space-y-1 text-sm">
                {product.variants.map((v) => <li key={v.id} className="flex justify-between"><span>{v.name}</span><span className={v._count.licenseKeys ? "text-success" : "text-subtle"}>{v._count.licenseKeys} available</span></li>)}
              </ul>
              <ActionForm action={addLicenseKeysAction} submitLabel="Add keys" submitVariant="secondary" resetOnSuccess>
                <input type="hidden" name="productId" value={product.id} />
                <Select name="variantId" aria-label="Option">{product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
                <Textarea name="keys" required placeholder="One key per line" className="min-h-24 font-mono text-xs" aria-label="Licence keys" />
              </ActionForm>
            </Panel>
          )}

          {digital && (
            <Panel title="Downloadable files">
              <ul className="mb-3 space-y-2 text-sm">
                {product.digitalAssets.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate">{a.fileName} <span className="text-xs text-subtle">({(a.size / 1024 / 1024).toFixed(1)} MB{a.variantId ? ` · ${product.variants.find((v) => v.id === a.variantId)?.name ?? "option"}` : ""})</span></span>
                    <form action={deleteDigitalFileAction}><input type="hidden" name="assetId" value={a.id} /><button className="text-danger" aria-label="Remove file"><Trash2 className="size-4" /></button></form>
                  </li>
                ))}
                {!product.digitalAssets.length && <li className="text-subtle">No files.</li>}
              </ul>
              <ActionForm action={uploadDigitalFileAction} submitLabel="Upload file" submitVariant="secondary" pendingLabel="Uploading…" resetOnSuccess>
                <input type="hidden" name="productId" value={product.id} />
                <Select name="variantId" aria-label="Applies to"><option value="">All options</option>{product.variants.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</Select>
                <Input name="file" type="file" required className="h-auto py-2 text-sm" aria-label="File" />
                <p className="text-xs text-subtle">Stored privately. Buyers get limited, expiring download links.</p>
              </ActionForm>
            </Panel>
          )}

          <Panel title="Danger zone">
            <p className="mb-3 text-sm text-muted">{product._count.orderItems ? "This product has orders, so it will be archived (hidden, kept for your records)." : "This product has never been ordered and will be deleted."}</p>
            <form action={deleteProductAction}><input type="hidden" name="id" value={product.id} /><Button variant="danger" size="sm">{product._count.orderItems ? "Archive product" : "Delete product"}</Button></form>
          </Panel>
        </div>
      </div>
    </div>
  );
}
