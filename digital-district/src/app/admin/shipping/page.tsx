import type { Metadata } from "next";
import type { ShippingZone } from "@prisma/client";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { getSettings } from "@/lib/settings";
import { centsToInput, formatMoney } from "@/lib/money";
import { saveZoneAction } from "@/app/admin/_actions/setup";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Alert, Badge, Checkbox, Field, Input } from "@/components/ui";

export const metadata: Metadata = { title: "Delivery zones" };

function ZoneFields({ z }: { z?: ShippingZone }) {
  const k = z?.id ?? "new";
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {z && <input type="hidden" name="id" value={z.id} />}
      <Field label="Area name" htmlFor={`zn-${k}`} required><Input id={`zn-${k}`} name="name" defaultValue={z?.name} required /></Field>
      <Field label="Delivery fee (USD)" htmlFor={`zf-${k}`}><Input id={`zf-${k}`} name="fee" inputMode="decimal" defaultValue={centsToInput(z?.fee ?? 0)} /></Field>
      <Field label="Free delivery from (USD)" htmlFor={`zt-${k}`} hint="Leave empty for never"><Input id={`zt-${k}`} name="freeShippingThreshold" inputMode="decimal" defaultValue={centsToInput(z?.freeShippingThreshold)} /></Field>
      <Field label="Estimated delivery" htmlFor={`ze-${k}`}><Input id={`ze-${k}`} name="estimatedDelivery" defaultValue={z?.estimatedDelivery ?? ""} placeholder="1–2 working days" /></Field>
      <Field label="Cities / areas covered" htmlFor={`za-${k}`} hint="Comma separated, shown to customers" className="md:col-span-2"><Input id={`za-${k}`} name="areas" defaultValue={z?.areas.join(", ")} /></Field>
      <Field label="Order" htmlFor={`zo-${k}`}><Input id={`zo-${k}`} name="sortOrder" defaultValue={z?.sortOrder ?? 0} /></Field>
      <div className="flex items-end gap-6 pb-2 md:col-span-2"><Checkbox name="isActive" defaultChecked={z ? z.isActive : true} label="Active" />{z && <Checkbox name="delete" label="Delete this area" />}</div>
    </div>
  );
}

export default async function ShippingPage() {
  await requireStaffPage("settings.manage");
  const [zones, s] = await Promise.all([db.shippingZone.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }), getSettings()]);
  const active = zones.filter((z) => z.isActive).length;
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Delivery zones" description="Delivery fees for physical products, by area. Digital products never need delivery." />
      {!active && !s.pickupEnabled && <Alert tone="warning" title="Physical delivery is switched off">No delivery area is active and pickup is off, so customers can only order physical products via WhatsApp. Set your fees and activate the areas you deliver to.</Alert>}
      {zones.map((z) => (
        <details key={z.id} className="rounded-2xl border border-line bg-surface">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3">
            <span className="flex-1 font-semibold text-white">{z.name}</span>
            <span className="text-sm text-muted">{formatMoney(z.fee)}{z.freeShippingThreshold != null ? ` · free from ${formatMoney(z.freeShippingThreshold)}` : ""}</span>
            <Badge tone={z.isActive ? "success" : "neutral"}>{z.isActive ? "active" : "inactive"}</Badge>
          </summary>
          <div className="border-t border-line p-5"><ActionForm action={saveZoneAction} submitLabel="Save area"><ZoneFields z={z} /></ActionForm></div>
        </details>
      ))}
      <Panel title="Add a delivery area"><ActionForm action={saveZoneAction} submitLabel="Add area" resetOnSuccess><ZoneFields /></ActionForm></Panel>
      <p className="text-xs text-subtle">Pickup, product-specific delivery surcharges and free-delivery products are set in Store settings and in each product.</p>
    </div>
  );
}
