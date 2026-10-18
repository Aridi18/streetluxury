import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { formatPhone } from "@/lib/phone";
import { deleteAddressAction, saveAddressAction, setDefaultAddressAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, Button, Checkbox, Field, Input, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Addresses" };

type Addr = { id?: string; label?: string | null; fullName?: string; phone?: string; city?: string; area?: string | null; addressLine?: string; building?: string | null; floor?: string | null; instructions?: string | null; isDefault?: boolean };

function AddressFields({ a = {} }: { a?: Addr }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {a.id && <input type="hidden" name="id" value={a.id} />}
      <Field label="Label" htmlFor={`label-${a.id ?? "new"}`} hint="e.g. Home, Office"><Input id={`label-${a.id ?? "new"}`} name="label" defaultValue={a.label ?? ""} maxLength={40} /></Field>
      <Field label="Recipient name" htmlFor={`fn-${a.id ?? "new"}`} required><Input id={`fn-${a.id ?? "new"}`} name="fullName" required defaultValue={a.fullName ?? ""} /></Field>
      <Field label="Phone" htmlFor={`ph-${a.id ?? "new"}`} required><Input id={`ph-${a.id ?? "new"}`} name="phone" type="tel" required defaultValue={a.phone ? formatPhone(a.phone) : ""} /></Field>
      <Field label="City / town" htmlFor={`ci-${a.id ?? "new"}`} required><Input id={`ci-${a.id ?? "new"}`} name="city" required defaultValue={a.city ?? ""} /></Field>
      <Field label="Area" htmlFor={`ar-${a.id ?? "new"}`}><Input id={`ar-${a.id ?? "new"}`} name="area" defaultValue={a.area ?? ""} /></Field>
      <Field label="Street address" htmlFor={`al-${a.id ?? "new"}`} required><Input id={`al-${a.id ?? "new"}`} name="addressLine" required defaultValue={a.addressLine ?? ""} /></Field>
      <Field label="Building" htmlFor={`bu-${a.id ?? "new"}`}><Input id={`bu-${a.id ?? "new"}`} name="building" defaultValue={a.building ?? ""} /></Field>
      <Field label="Floor" htmlFor={`fl-${a.id ?? "new"}`}><Input id={`fl-${a.id ?? "new"}`} name="floor" defaultValue={a.floor ?? ""} /></Field>
      <Field label="Delivery instructions" htmlFor={`in-${a.id ?? "new"}`} className="sm:col-span-2"><Textarea id={`in-${a.id ?? "new"}`} name="instructions" defaultValue={a.instructions ?? ""} className="min-h-16" /></Field>
      <Checkbox name="isDefault" defaultChecked={a.isDefault} label="Use as my default address" className="sm:col-span-2" />
    </div>
  );
}

export default async function AddressesPage() {
  const user = await requireUser("/account/addresses");
  const addresses = await db.address.findMany({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] });
  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Saved addresses</h2>
      {addresses.map((a) => (
        <div key={a.id} className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="text-sm">
              <p className="font-semibold text-white">{a.label || a.fullName} {a.isDefault && <Badge tone="accent" className="ml-2">Default</Badge>}</p>
              <p className="text-muted">{a.fullName} · {formatPhone(a.phone)}</p>
              <p className="text-muted">{[a.addressLine, a.building, a.floor && `Floor ${a.floor}`, a.area, a.city].filter(Boolean).join(", ")}</p>
            </div>
            <div className="flex gap-2">
              {!a.isDefault && <form action={setDefaultAddressAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="ghost">Make default</Button></form>}
              <form action={deleteAddressAction}><input type="hidden" name="id" value={a.id} /><Button size="sm" variant="ghost" className="hover:text-danger">Delete</Button></form>
            </div>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-brand-300">Edit</summary>
            <ActionForm action={saveAddressAction} submitLabel="Save address" className="mt-4"><AddressFields a={a} /></ActionForm>
          </details>
        </div>
      ))}
      <details className="card p-5" open={addresses.length === 0}>
        <summary className="cursor-pointer font-semibold">Add a new address</summary>
        <ActionForm action={saveAddressAction} submitLabel="Add address" className="mt-4" resetOnSuccess><AddressFields /></ActionForm>
      </details>
    </div>
  );
}
