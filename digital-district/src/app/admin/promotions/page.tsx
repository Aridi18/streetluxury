import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { centsToInput, formatMoney } from "@/lib/money";
import { toZonedInput } from "@/lib/time";
import { savePromotionAction } from "@/app/admin/_actions/promotions";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, fmtDateTime } from "@/components/admin/ui";
import { Badge, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Promotions & coupons" };

type Promo = Prisma.PromotionGetPayload<{ include: { products: true; categories: true } }>;

function PromotionFields({ p, products, categories }: { p?: Promo; products: { id: string; title: string }[]; categories: { id: string; name: string }[] }) {
  const k = p?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Name" htmlFor={`pn-${k}`} hint="For your reference, e.g. Ramadan sale"><Input id={`pn-${k}`} name="name" defaultValue={p?.name} required /></Field>
      <Field label="Coupon code" htmlFor={`pc-${k}`} hint="Leave empty for an automatic sale (no code needed)"><Input id={`pc-${k}`} name="code" defaultValue={p?.code ?? ""} className="uppercase" /></Field>
      <Field label="Discount type" htmlFor={`pt-${k}`}>
        <Select id={`pt-${k}`} name="type" defaultValue={p?.type ?? "PERCENT"}><option value="PERCENT">Percentage off</option><option value="FIXED">Fixed amount off (USD)</option><option value="FREE_SHIPPING">Free delivery (code only)</option></Select>
      </Field>
      <Field label="Value" htmlFor={`pv-${k}`} hint="e.g. 10 for 10% or 5 for $5 off"><Input id={`pv-${k}`} name="value" inputMode="decimal" defaultValue={p ? (p.type === "PERCENT" ? String(p.value / 100) : centsToInput(p.value)) : ""} /></Field>
      <Field label="Applies to" htmlFor={`ps-${k}`}>
        <Select id={`ps-${k}`} name="scope" defaultValue={p?.scope ?? "ALL"}><option value="ALL">Everything</option><option value="PRODUCTS">Selected products</option><option value="CATEGORIES">Selected categories</option></Select>
      </Field>
      <Field label="Minimum order (USD)" htmlFor={`pm-${k}`}><Input id={`pm-${k}`} name="minOrderAmount" inputMode="decimal" defaultValue={centsToInput(p?.minOrderAmount)} /></Field>
      <Field label="Products (if “selected products”)" htmlFor={`pp-${k}`}>
        <select id={`pp-${k}`} name="productIds" multiple defaultValue={p?.products.map((x) => x.productId)} className="h-32 w-full rounded-xl border border-line-strong bg-surface-2 p-2 text-sm">{products.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select>
      </Field>
      <Field label="Categories (if “selected categories”)" htmlFor={`pk-${k}`}>
        <select id={`pk-${k}`} name="categoryIds" multiple defaultValue={p?.categories.map((x) => x.categoryId)} className="h-32 w-full rounded-xl border border-line-strong bg-surface-2 p-2 text-sm">{categories.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
      </Field>
      <Field label="Starts (Lebanon time)" htmlFor={`pa-${k}`}><Input id={`pa-${k}`} name="startsAt" type="datetime-local" defaultValue={toZonedInput(p?.startsAt)} className="[color-scheme:dark]" /></Field>
      <Field label="Ends (Lebanon time)" htmlFor={`pe-${k}`} hint="A countdown is shown to customers"><Input id={`pe-${k}`} name="endsAt" type="datetime-local" defaultValue={toZonedInput(p?.endsAt)} className="[color-scheme:dark]" /></Field>
      <Field label="Maximum discount (USD)" htmlFor={`px-${k}`} hint="Caps percentage discounts"><Input id={`px-${k}`} name="maxDiscount" inputMode="decimal" defaultValue={centsToInput(p?.maxDiscount)} /></Field>
      <Field label="Total uses allowed" htmlFor={`pu-${k}`}><Input id={`pu-${k}`} name="usageLimit" inputMode="numeric" defaultValue={p?.usageLimit ?? ""} /></Field>
      <Field label="Uses per customer" htmlFor={`pq-${k}`} hint="Matched by account, phone or email"><Input id={`pq-${k}`} name="usageLimitPerCustomer" inputMode="numeric" defaultValue={p?.usageLimitPerCustomer ?? ""} /></Field>
      <Field label="Public description" htmlFor={`pd-${k}`}><Textarea id={`pd-${k}`} name="description" defaultValue={p?.description ?? ""} className="min-h-12" /></Field>
      <div className="flex flex-wrap gap-x-6 gap-y-2 md:col-span-2">
        <Checkbox name="isActive" defaultChecked={p ? p.isActive : true} label="Active" />
        <Checkbox name="firstOrderOnly" defaultChecked={p?.firstOrderOnly} label="First order only" />
        <Checkbox name="showOnHome" defaultChecked={p?.showOnHome} label="Advertise on the homepage" />
      </div>
    </div>
  );
}

export default async function PromotionsPage() {
  await requireStaffPage("promotions.manage");
  const [promos, products, categories] = await Promise.all([
    db.promotion.findMany({ orderBy: { createdAt: "desc" }, include: { products: true, categories: true } }),
    db.product.findMany({ where: { deletedAt: null, status: { not: "ARCHIVED" } }, orderBy: { title: "asc" }, select: { id: true, title: true } }),
    db.category.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const now = new Date();
  const state = (p: Promo) => (!p.isActive ? ["Paused", "neutral"] : p.endsAt && p.endsAt <= now ? ["Ended", "neutral"] : p.startsAt && p.startsAt > now ? ["Scheduled", "info"] : p.usageLimit != null && p.usageCount >= p.usageLimit ? ["Used up", "neutral"] : ["Live", "success"]) as [string, "neutral" | "info" | "success"];
  return (
    <div className="max-w-5xl">
      <PageHeader title="Promotions & coupons" description="Automatic sales change prices in the store (shown struck through). Coupon codes are entered by customers in the cart. All rules are checked on the server at checkout." />
      <Panel title="New promotion" className="mb-6"><ActionForm action={savePromotionAction} submitLabel="Create promotion" resetOnSuccess><PromotionFields products={products} categories={categories} /></ActionForm></Panel>
      <div className="space-y-2">
        {promos.map((p) => {
          const [label, tone] = state(p);
          return (
            <details key={p.id} className="rounded-2xl border border-line bg-surface">
              <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-4 py-3">
                <span className="flex-1 font-semibold text-white">{p.name} {p.code && <span className="ml-2 rounded-md border border-brand-400/40 px-2 py-0.5 font-mono text-xs text-brand-100">{p.code}</span>}</span>
                <span className="text-sm text-muted">{p.type === "PERCENT" ? `${p.value / 100}% off` : p.type === "FIXED" ? `${formatMoney(p.value)} off` : "Free delivery"} · {p.scope === "ALL" ? "everything" : p.scope === "PRODUCTS" ? `${p.products.length} products` : `${p.categories.length} categories`}</span>
                <span className="text-xs text-subtle">{p.usageCount} use{p.usageCount === 1 ? "" : "s"}{p.endsAt ? ` · ends ${fmtDateTime(p.endsAt)}` : ""}</span>
                <Badge tone={tone}>{label}</Badge>
              </summary>
              <div className="border-t border-line p-4"><ActionForm action={savePromotionAction} submitLabel="Save"><PromotionFields p={p} products={products} categories={categories} /></ActionForm></div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
