import type { Metadata } from "next";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { centsToInput } from "@/lib/money";
import { mpgsConfigured } from "@/lib/payments";
import { createPaymentMethodAction, savePaymentMethodAction } from "@/app/admin/_actions/setup";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel } from "@/components/admin/ui";
import { Alert, Badge, Checkbox, Field, Input, Select, Textarea } from "@/components/ui";

export const metadata: Metadata = { title: "Payment methods" };
const KIND = { MANUAL: "Transfer + reference (verified by staff)", ARRANGED: "Agreed on WhatsApp after the order", CASH_ON_DELIVERY: "Cash on delivery", ONLINE_CARD: "Online card (bank hosted page)" } as const;

export default async function PaymentsPage() {
  await requireStaffPage("settings.manage");
  const methods = await db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Payment methods" description="Turn methods on or off and write the instructions customers see. Transfers stay “pending verification” until a staff member confirms the money arrived." />
      {!mpgsConfigured() && <Alert tone="info">Online card payments are not connected. They need a merchant account with a Lebanese acquirer that offers Mastercard Payment Gateway hosted checkout (for example areeba), with its credentials set on the server.</Alert>}
      {methods.map((m) => (
        <details key={m.id} className="rounded-2xl border border-line bg-surface" open={m.kind === "MANUAL" && !m.instructions}>
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 px-5 py-4">
            <span className="flex-1"><span className="font-semibold text-white">{m.name}</span><span className="block text-xs text-subtle">{KIND[m.kind]}</span></span>
            {m.kind === "MANUAL" && !m.instructions && <Badge tone="warning">Needs instructions</Badge>}
            <Badge tone={m.isEnabled ? "success" : "neutral"}>{m.isEnabled ? "On" : "Off"}</Badge>
          </summary>
          <div className="border-t border-line p-5">
            <ActionForm action={savePaymentMethodAction} submitLabel="Save">
              <input type="hidden" name="id" value={m.id} />
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Name shown to customers" htmlFor={`n-${m.id}`}><Input id={`n-${m.id}`} name="name" defaultValue={m.name} /></Field>
                <Field label="Available for" htmlFor={`a-${m.id}`}><Select id={`a-${m.id}`} name="appliesTo" defaultValue={m.appliesTo}><option value="ALL">All orders</option><option value="PHYSICAL_ONLY">Orders with physical delivery</option><option value="DIGITAL_ONLY">Digital-only orders</option></Select></Field>
                <Field label="Short description (at checkout)" htmlFor={`d-${m.id}`} className="md:col-span-2"><Input id={`d-${m.id}`} name="description" defaultValue={m.description ?? ""} /></Field>
                <Field label="Payment instructions (after ordering)" htmlFor={`i-${m.id}`} className="md:col-span-2" hint={m.kind === "MANUAL" ? "Include the exact account / phone number / wallet address, the account name and any steps. Customers are told to use their order number as the reference." : undefined}>
                  <Textarea id={`i-${m.id}`} name="instructions" defaultValue={m.instructions ?? ""} className="min-h-24" />
                </Field>
                <Field label="Processing fee (%)" htmlFor={`fp-${m.id}`} hint="Recorded as an expense on each payment"><Input id={`fp-${m.id}`} name="feePercent" inputMode="decimal" defaultValue={String(m.feePercentBps / 100)} /></Field>
                <Field label="Fixed fee per payment (USD)" htmlFor={`ff-${m.id}`}><Input id={`ff-${m.id}`} name="feeFixed" inputMode="decimal" defaultValue={centsToInput(m.feeFixed)} /></Field>
                <Field label="Display order" htmlFor={`o-${m.id}`}><Input id={`o-${m.id}`} name="sortOrder" defaultValue={m.sortOrder} /></Field>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <Checkbox name="isEnabled" defaultChecked={m.isEnabled} label="Enabled" />
                {m.kind === "MANUAL" && <Checkbox name="requiresReference" defaultChecked={m.requiresReference} label="Transaction reference required" />}
                {m.kind === "MANUAL" && <Checkbox name="allowProofUpload" defaultChecked={m.allowProofUpload} label="Allow payment proof upload" />}
              </div>
            </ActionForm>
          </div>
        </details>
      ))}
      <Panel title="Add another method">
        <ActionForm action={createPaymentMethodAction} submitLabel="Add method" submitVariant="secondary" resetOnSuccess>
          <div className="grid gap-3 md:grid-cols-2">
            <Input name="name" placeholder="e.g. BOB Finance, Western Union" required aria-label="Name" />
            <Select name="kind" aria-label="Type"><option value="MANUAL">Transfer + reference</option><option value="ARRANGED">Agreed on WhatsApp</option></Select>
          </div>
        </ActionForm>
      </Panel>
    </div>
  );
}
