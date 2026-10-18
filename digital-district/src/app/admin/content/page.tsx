import type { Metadata } from "next";
import type { Banner } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { imageUrl } from "@/lib/media";
import { toZonedInput } from "@/lib/time";
import { deleteBannerAction, saveBannerAction, saveSettingsAction } from "@/app/admin/_actions/content";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { BENEFIT_ICON_NAMES } from "@/components/store/icons";
import { Badge, Button, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Homepage & banners" };

const SECTION_LABELS: Record<string, string> = {
  hero: "Hero (headline, search, buttons)", categories: "Shop by category", offers: "Current offers & countdowns", featured: "Featured products", bestsellers: "Bestsellers",
  newArrivals: "New arrivals", collections: "Featured collections", recentlyViewed: "Recently viewed (per visitor)", reviews: "Customer reviews (verified only)", howItWorks: "How ordering works",
  benefits: "Benefits & guarantees", newsletter: "Newsletter signup",
};

function BannerFields({ b }: { b?: Banner }) {
  const k = b?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {b && <input type="hidden" name="id" value={b.id} />}
      <Field label="Small label above the headline" htmlFor={`be-${k}`}><Input id={`be-${k}`} name="eyebrow" defaultValue={b?.eyebrow ?? ""} /></Field>
      <Field label="Headline" htmlFor={`bt-${k}`} required><Input id={`bt-${k}`} name="title" defaultValue={b?.title} required /></Field>
      <Field label="Text" htmlFor={`bs-${k}`} className="md:col-span-2"><Textarea id={`bs-${k}`} name="subtitle" defaultValue={b?.subtitle ?? ""} className="min-h-16" /></Field>
      <Field label="Button text" htmlFor={`bl-${k}`}><Input id={`bl-${k}`} name="ctaLabel" defaultValue={b?.ctaLabel ?? ""} placeholder="Shop the offer" /></Field>
      <Field label="Button link" htmlFor={`bh-${k}`}><Input id={`bh-${k}`} name="ctaHref" defaultValue={b?.ctaHref ?? ""} placeholder="/offers" /></Field>
      <Field label="Starts" htmlFor={`ba-${k}`}><Input id={`ba-${k}`} name="startsAt" type="datetime-local" defaultValue={toZonedInput(b?.startsAt)} className="[color-scheme:dark]" /></Field>
      <Field label="Ends" htmlFor={`bz-${k}`}><Input id={`bz-${k}`} name="endsAt" type="datetime-local" defaultValue={toZonedInput(b?.endsAt)} className="[color-scheme:dark]" /></Field>
      <Field label="Image (portrait works best)" htmlFor={`bi-${k}`}><Input id={`bi-${k}`} name="image" type="file" accept="image/*" className="h-auto py-2 text-sm" /></Field>
      <Field label="Order" htmlFor={`bo-${k}`}><Input id={`bo-${k}`} name="sortOrder" defaultValue={b?.sortOrder ?? 0} /></Field>
      <Checkbox name="isActive" defaultChecked={b ? b.isActive : true} label="Active" />
    </div>
  );
}

export default async function ContentPage() {
  await requireStaffPage("content.manage");
  const [s, banners] = await Promise.all([getSettings(), db.banner.findMany({ orderBy: { sortOrder: "asc" } })]);
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="Homepage & banners" description="Choose what appears on the homepage and in which order." />
      <Panel title="Homepage layout & text">
        <ActionForm action={saveSettingsAction} submitLabel="Save homepage">
          <input type="hidden" name="section" value="homepage" />
          <div className="grid gap-2 md:grid-cols-2">
            {s.homeSections.map((sec, i) => (
              <div key={sec.key} className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
                <Input name={`ord_${sec.key}`} defaultValue={i + 1} inputMode="numeric" className="h-8 w-14 text-center text-sm" aria-label={`Order of ${SECTION_LABELS[sec.key]}`} />
                <Checkbox name={`sec_${sec.key}`} defaultChecked={sec.enabled} label={SECTION_LABELS[sec.key] ?? sec.key} />
              </div>
            ))}
          </div>
          <p className="text-xs text-subtle">Numbers set the order (1 = top). Sections with nothing to show (e.g. no offers running) are hidden automatically.</p>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Hero label" htmlFor="heroEyebrow"><Input id="heroEyebrow" name="heroEyebrow" defaultValue={s.heroEyebrow} /></Field>
            <Field label="Hero headline" htmlFor="heroTitle"><Input id="heroTitle" name="heroTitle" defaultValue={s.heroTitle} /></Field>
            <Field label="Hero text" htmlFor="heroSubtitle" className="md:col-span-2"><Textarea id="heroSubtitle" name="heroSubtitle" defaultValue={s.heroSubtitle} className="min-h-16" /></Field>
          </div>
          <p className="pt-2 text-sm font-semibold">Benefits & guarantees</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[140px_1fr_2fr]">
              <Select name={`b_icon_${i}`} defaultValue={s.benefits[i]?.icon ?? "badge"} aria-label="Icon">{BENEFIT_ICON_NAMES.map((n) => <option key={n}>{n}</option>)}</Select>
              <Input name={`b_title_${i}`} defaultValue={s.benefits[i]?.title ?? ""} placeholder="Title" aria-label="Benefit title" />
              <Input name={`b_text_${i}`} defaultValue={s.benefits[i]?.text ?? ""} placeholder="Short text" aria-label="Benefit text" />
            </div>
          ))}
          <p className="pt-2 text-sm font-semibold">How ordering works</p>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="grid gap-2 md:grid-cols-[1fr_2fr]">
              <Input name={`h_title_${i}`} defaultValue={s.howItWorks[i]?.title ?? ""} placeholder={`Step ${i + 1}`} aria-label="Step title" />
              <Input name={`h_text_${i}`} defaultValue={s.howItWorks[i]?.text ?? ""} placeholder="Short explanation" aria-label="Step text" />
            </div>
          ))}
          <Field label="Extra footer links" htmlFor="footerLinks" hint="One per line: Label | /link or https://…"><Textarea id="footerLinks" name="footerLinks" defaultValue={s.footerLinks.map((l) => `${l.label} | ${l.href}`).join("\n")} className="min-h-16 font-mono text-sm" /></Field>
        </ActionForm>
      </Panel>
      <Panel title="Hero banners" actions={<span className="text-xs text-subtle">The first active banner replaces the default hero text. Scheduled banners switch on and off automatically.</span>}>
        <details className="mb-4 rounded-xl border border-dashed border-line-strong p-4">
          <summary className="cursor-pointer font-semibold">Add a banner</summary>
          <ActionForm action={saveBannerAction} submitLabel="Add banner" className="mt-4" resetOnSuccess><BannerFields /></ActionForm>
        </details>
        <div className="space-y-2">
          {banners.map((b) => (
            <details key={b.id} className="rounded-xl border border-line bg-surface-2">
              <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {b.imageKey && <img src={imageUrl(b.imageKey, 400)!} alt="" className="h-10 w-16 rounded object-cover" />}
                <span className="flex-1 font-semibold">{b.title}</span>
                <Badge tone={b.isActive ? "success" : "neutral"}>{b.isActive ? "active" : "off"}</Badge>
              </summary>
              <div className="space-y-3 border-t border-line p-4">
                <ActionForm action={saveBannerAction} submitLabel="Save banner"><BannerFields b={b} /></ActionForm>
                <form action={deleteBannerAction}><input type="hidden" name="id" value={b.id} /><Button size="sm" variant="danger">Delete banner</Button></form>
              </div>
            </details>
          ))}
        </div>
      </Panel>
    </div>
  );
}
