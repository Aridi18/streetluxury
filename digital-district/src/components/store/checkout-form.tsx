"use client";

import { useActionState, useState } from "react";
import { Lock } from "lucide-react";
import { placeOrderAction } from "@/app/actions/checkout";
import { formatMoney } from "@/lib/money";
import { Alert, Checkbox, Field, Input, Select, Textarea, cn } from "../ui";
import { SubmitButton } from "../submit-button";
import { WhatsAppIcon } from "./icons";

type Quote = { shippingTotal: number; taxTotal: number; total: number; freeShippingReason: string | null };

export type CheckoutProps = {
  mode: "website" | "whatsapp";
  idempotencyKey: string;
  requiresShipping: boolean;
  currency: string;
  zones: { id: string; name: string; fee: number; areas: string[]; estimatedDelivery: string | null; freeShippingThreshold: number | null }[];
  pickup: { enabled: boolean; address: string; instructions: string };
  quotes: { none: Quote; pickup: Quote; zones: Record<string, Quote> };
  paymentMethods: { id: string; name: string; description: string | null; kind: string }[];
  defaults: { name: string; email: string; phone: string; city: string; area: string; address: string; instructions: string; zoneId: string };
  signedIn: boolean;
  taxLabel: string | null;
  taxInclusive: boolean;
  summary: React.ReactNode;
};

export function CheckoutForm(p: CheckoutProps) {
  const [state, action] = useActionState(placeOrderAction, null);
  const defaultMethod = p.requiresShipping ? (p.zones.length ? "DELIVERY" : p.pickup.enabled ? "PICKUP" : "DELIVERY") : "NONE";
  const [method, setMethod] = useState<"DELIVERY" | "PICKUP" | "NONE">(defaultMethod);
  const [zoneId, setZoneId] = useState(p.zones.some((z) => z.id === p.defaults.zoneId) ? p.defaults.zoneId : "");
  const [paymentId, setPaymentId] = useState(p.paymentMethods[0]?.id ?? "");
  const quote: Quote | null = method === "NONE" ? p.quotes.none : method === "PICKUP" ? p.quotes.pickup : zoneId ? p.quotes.zones[zoneId] : null;
  const m = (c: number) => formatMoney(c, p.currency);
  const err = (k: string) => (state && !state.ok ? state.fieldErrors?.[k] : undefined);
  const deliveryUnavailable = p.requiresShipping && p.zones.length === 0 && !p.pickup.enabled;

  return (
    <form action={action} className="grid gap-8 lg:grid-cols-[1fr_400px]" noValidate={false}>
      <input type="hidden" name="idempotencyKey" value={p.idempotencyKey} />
      <input type="hidden" name="mode" value={p.mode} />
      <input type="hidden" name="deliveryMethod" value={deliveryUnavailable ? "NONE" : method} />
      <div className="space-y-6">
        <section className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Your details</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" htmlFor="name" required error={err("name")}>
              <Input id="name" name="name" required autoComplete="name" defaultValue={p.defaults.name} maxLength={120} />
            </Field>
            <Field label="Phone / WhatsApp" htmlFor="phone" required error={err("phone")} hint="Lebanese or international number">
              <Input id="phone" name="phone" type="tel" required autoComplete="tel" inputMode="tel" placeholder="81 745 567 or +961…" defaultValue={p.defaults.phone} maxLength={40} />
            </Field>
            <Field label="Email" htmlFor="email" error={err("email")} hint={p.mode === "whatsapp" ? "Optional" : "Optional — for your receipt and order updates"}>
              <Input id="email" name="email" type="email" autoComplete="email" defaultValue={p.defaults.email} maxLength={200} />
            </Field>
            <Field label="Preferred contact" htmlFor="preferredContact">
              <Select id="preferredContact" name="preferredContact" defaultValue="WHATSAPP">
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PHONE">Phone call</option>
                <option value="EMAIL">Email</option>
              </Select>
            </Field>
          </div>
        </section>

        {p.requiresShipping && (
          <section className="card space-y-4 p-6">
            <h2 className="text-lg font-semibold">Delivery</h2>
            {deliveryUnavailable ? (
              <Alert tone="warning" title="Delivery is not set up yet">Please order via WhatsApp and we will arrange delivery with you directly.</Alert>
            ) : (
              <>
                <div className="grid gap-2 sm:grid-cols-2">
                  {p.zones.length > 0 && (
                    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", method === "DELIVERY" ? "border-brand-400 bg-brand-500/10" : "border-line-strong")}>
                      <input type="radio" name="_dm" checked={method === "DELIVERY"} onChange={() => setMethod("DELIVERY")} className="mt-1 accent-brand-500" />
                      <span><span className="block font-semibold">Home delivery</span><span className="text-sm text-muted">Delivered to your address</span></span>
                    </label>
                  )}
                  {p.pickup.enabled && (
                    <label className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", method === "PICKUP" ? "border-brand-400 bg-brand-500/10" : "border-line-strong")}>
                      <input type="radio" name="_dm" checked={method === "PICKUP"} onChange={() => setMethod("PICKUP")} className="mt-1 accent-brand-500" />
                      <span><span className="block font-semibold">Pickup — free</span><span className="text-sm text-muted">{p.pickup.address}</span></span>
                    </label>
                  )}
                </div>
                {method === "DELIVERY" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Delivery area" htmlFor="zoneId" required className="sm:col-span-2" error={err("zoneId")}>
                      <Select id="zoneId" name="zoneId" required value={zoneId} onChange={(e) => setZoneId(e.target.value)}>
                        <option value="" disabled>Choose your area…</option>
                        {p.zones.map((z) => (
                          <option key={z.id} value={z.id}>
                            {z.name} — {z.fee === 0 ? "Free" : m(z.fee)}{z.estimatedDelivery ? ` · ${z.estimatedDelivery}` : ""}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="City / town" htmlFor="city" required error={err("city")}>
                      <Input id="city" name="city" required autoComplete="address-level2" defaultValue={p.defaults.city} maxLength={120} />
                    </Field>
                    <Field label="Area / neighbourhood" htmlFor="area">
                      <Input id="area" name="area" autoComplete="address-level3" defaultValue={p.defaults.area} maxLength={120} />
                    </Field>
                    <Field label="Street, building and floor" htmlFor="address" required className="sm:col-span-2" error={err("address")}>
                      <Input id="address" name="address" required autoComplete="street-address" defaultValue={p.defaults.address} maxLength={300} />
                    </Field>
                    <Field label="Delivery instructions" htmlFor="instructions" className="sm:col-span-2" hint="Landmarks, best time to deliver…">
                      <Textarea id="instructions" name="instructions" defaultValue={p.defaults.instructions} maxLength={500} className="min-h-20" />
                    </Field>
                    {p.signedIn && <Checkbox name="saveAddress" defaultChecked label="Save this address to my account" className="sm:col-span-2" />}
                  </div>
                )}
                {method === "PICKUP" && p.pickup.instructions && <p className="text-sm text-muted">{p.pickup.instructions}</p>}
              </>
            )}
          </section>
        )}

        {p.mode === "website" && (
          <section className="card space-y-4 p-6">
            <h2 className="text-lg font-semibold">Payment</h2>
            {p.paymentMethods.length === 0 ? (
              <Alert tone="warning">No payment method is available for this order online. Please order via WhatsApp.</Alert>
            ) : (
              <div className="space-y-2">
                {p.paymentMethods.map((pm) => (
                  <label key={pm.id} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-4", paymentId === pm.id ? "border-brand-400 bg-brand-500/10" : "border-line-strong")}>
                    <input type="radio" name="paymentMethodId" value={pm.id} checked={paymentId === pm.id} onChange={() => setPaymentId(pm.id)} className="mt-1 accent-brand-500" />
                    <span>
                      <span className="block font-semibold">{pm.name}</span>
                      {pm.description && <span className="text-sm text-muted">{pm.description}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="card space-y-4 p-6">
          <Field label="Order notes" htmlFor="note" hint="Optional">
            <Textarea id="note" name="note" maxLength={1000} placeholder="Anything else we should know?" />
          </Field>
        </section>
      </div>

      <aside className="h-fit space-y-5 lg:sticky lg:top-36">
        <div className="card space-y-4 p-6">
          <h2 className="text-lg font-semibold">Review your order</h2>
          {p.summary}
          <dl className="space-y-2 border-t border-line pt-4 text-sm">
            {p.requiresShipping && (
              <div className="flex justify-between">
                <dt className="text-muted">Delivery</dt>
                <dd>{quote ? (quote.shippingTotal === 0 ? <span className="text-success">{method === "PICKUP" ? "Pickup" : "Free"}</span> : m(quote.shippingTotal)) : <span className="text-subtle">Choose an area</span>}</dd>
              </div>
            )}
            {quote?.freeShippingReason && method === "DELIVERY" && <p className="text-xs text-success">{quote.freeShippingReason}</p>}
            {quote && quote.taxTotal > 0 && p.taxLabel && (
              <div className="flex justify-between text-subtle"><dt>{p.taxInclusive ? `Includes ${p.taxLabel}` : p.taxLabel}</dt><dd>{m(quote.taxTotal)}</dd></div>
            )}
          </dl>
          <div className="flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-semibold">Total</span>
            <span className="font-display text-2xl font-bold text-white">{quote ? m(quote.total) : "—"}</span>
          </div>
          <Checkbox name="acceptTerms" required label={<>I agree to the <a href="/terms" target="_blank" className="text-brand-300 underline">terms & conditions</a> and <a href="/refund-policy" target="_blank" className="text-brand-300 underline">refund policy</a>.</>} />
          {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
          {p.mode === "whatsapp" ? (
            <SubmitButton variant="whatsapp" size="lg" className="w-full" pendingLabel="Preparing your order…" disabled={!quote && !deliveryUnavailable}>
              <WhatsAppIcon className="size-5" /> Continue to WhatsApp
            </SubmitButton>
          ) : (
            <SubmitButton size="lg" className="w-full" pendingLabel="Placing your order…" disabled={!quote || deliveryUnavailable || !paymentId}>
              <Lock className="size-4" /> Place order
            </SubmitButton>
          )}
          <p className="text-center text-xs text-subtle">
            {p.mode === "whatsapp"
              ? "We save your order and prepare a WhatsApp message with the details. Your order is confirmed by our team on WhatsApp."
              : "Your order total is checked again on our server before it is placed."}
          </p>
        </div>
      </aside>
    </form>
  );
}
