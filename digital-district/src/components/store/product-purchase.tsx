"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Minus, Plus, ShoppingBag, Zap } from "lucide-react";
import { addToCartAction } from "@/app/actions/cart";
import { formatMoney } from "@/lib/money";
import { waLink, productInquiryMessage } from "@/lib/whatsapp";
import type { CustomFieldDef } from "@/lib/cart";
import { Alert, Input, Select, Textarea, buttonClass, cn } from "../ui";
import { SubmitButton } from "../submit-button";
import { WhatsAppIcon } from "./icons";
import { Countdown } from "./countdown";

export type PurchaseVariant = {
  id: string;
  name: string;
  optionValues: Record<string, string>;
  price: number;
  was: number | null;
  available: number; // 99 when unlimited
  tracked: boolean;
  durationDays: number | null;
  saleEndsAt: string | null;
};

export function ProductPurchase({
  productTitle,
  productUrl,
  variants,
  customFields,
  allowNote,
  whatsappNumber,
  currency,
}: {
  productTitle: string;
  productUrl: string;
  variants: PurchaseVariant[];
  customFields: CustomFieldDef[];
  allowNote: boolean;
  whatsappNumber: string;
  currency: string;
}) {
  const optionNames = useMemo(() => {
    const names: string[] = [];
    for (const v of variants) for (const k of Object.keys(v.optionValues)) if (!names.includes(k)) names.push(k);
    return names;
  }, [variants]);
  const firstAvailable = variants.find((v) => v.available > 0) ?? variants[0];
  const [selection, setSelection] = useState<Record<string, string>>(firstAvailable?.optionValues ?? {});
  const [quantity, setQuantity] = useState(1);
  const [state, action] = useActionState(addToCartAction, null);

  const variant =
    variants.length === 1 ? variants[0] : variants.find((v) => optionNames.every((n) => v.optionValues[n] === selection[n])) ?? null;
  const maxQty = Math.max(1, Math.min(99, variant?.available ?? 1));

  function choose(name: string, value: string) {
    const next = { ...selection, [name]: value };
    // If the exact combination doesn't exist, jump to the closest variant with this value.
    if (!variants.some((v) => optionNames.every((n) => v.optionValues[n] === next[n]))) {
      const fallback = variants.find((v) => v.optionValues[name] === value);
      if (fallback) {
        setSelection(fallback.optionValues);
        return;
      }
    }
    setSelection(next);
    setQuantity(1);
  }

  const inquiry = waLink(whatsappNumber, productInquiryMessage(productTitle, productUrl, variant && variant.name !== "Default" ? variant.name : undefined));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-baseline gap-3">
        {variant ? (
          <>
            <span className="font-display text-4xl font-bold text-white">{formatMoney(variant.price, currency)}</span>
            {variant.was && (
              <>
                <s className="text-lg text-subtle">{formatMoney(variant.was, currency)}</s>
                <span className="rounded-full bg-brand-500 px-2.5 py-1 text-xs font-bold text-white">Save {Math.round(((variant.was - variant.price) / variant.was) * 100)}%</span>
              </>
            )}
          </>
        ) : (
          <span className="text-muted">Choose an option</span>
        )}
      </div>
      {variant?.saleEndsAt && <Countdown endsAt={variant.saleEndsAt} className="inline-flex rounded-full border border-brand-500/40 bg-brand-500/10 px-3 py-1 font-mono text-xs text-brand-100" />}

      <form action={action} className="space-y-6">
        <input type="hidden" name="variantId" value={variant?.id ?? ""} />
        {optionNames.map((name) => {
          const values = [...new Set(variants.map((v) => v.optionValues[name]).filter(Boolean))];
          return (
            <fieldset key={name}>
              <legend className="mb-2.5 text-sm font-semibold text-white">
                {name}: <span className="font-normal text-muted">{selection[name]}</span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {values.map((value) => {
                  const match = variants.filter((v) => v.optionValues[name] === value);
                  const soldOut = match.every((v) => v.available <= 0);
                  const selected = selection[name] === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => choose(name, value)}
                      aria-pressed={selected}
                      className={cn(
                        "rounded-xl border px-4 py-2.5 text-sm font-medium transition",
                        selected ? "border-brand-400 bg-brand-500/15 text-white shadow-[var(--shadow-glow)]" : "border-line-strong text-fg/90 hover:border-brand-400/60",
                        soldOut && "line-through opacity-50",
                      )}
                    >
                      {value}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        {customFields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <label htmlFor={`cf-${f.key}`} className="text-sm font-medium text-white">
              {f.label} {f.required && <span className="text-brand-300">*</span>}
            </label>
            {f.type === "textarea" ? (
              <Textarea id={`cf-${f.key}`} name={`cf_${f.key}`} required={f.required} placeholder={f.placeholder} maxLength={1000} />
            ) : f.type === "select" ? (
              <Select id={`cf-${f.key}`} name={`cf_${f.key}`} required={f.required} defaultValue="">
                <option value="" disabled>Choose…</option>
                {f.options?.map((o) => <option key={o}>{o}</option>)}
              </Select>
            ) : (
              <Input id={`cf-${f.key}`} name={`cf_${f.key}`} type={f.type === "email" ? "email" : "text"} required={f.required} placeholder={f.placeholder} maxLength={300} />
            )}
          </div>
        ))}

        {allowNote && (
          <details className="group">
            <summary className="cursor-pointer text-sm text-brand-300 hover:text-brand-200">Add a note for this item (optional)</summary>
            <Textarea name="note" className="mt-2" maxLength={1000} placeholder="Anything we should know about this item?" />
          </details>
        )}

        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-white">Quantity</span>
          <div className="flex items-center rounded-xl border border-line-strong">
            <button type="button" className="grid size-11 place-items-center text-muted hover:text-white disabled:opacity-40" onClick={() => setQuantity((q) => Math.max(1, q - 1))} disabled={quantity <= 1} aria-label="Decrease quantity">
              <Minus className="size-4" />
            </button>
            <input name="quantity" value={quantity} onChange={(e) => setQuantity(Math.min(maxQty, Math.max(1, Number(e.target.value.replace(/\D/g, "")) || 1)))} inputMode="numeric" aria-label="Quantity" className="h-11 w-12 bg-transparent text-center font-semibold focus:outline-none" />
            <button type="button" className="grid size-11 place-items-center text-muted hover:text-white disabled:opacity-40" onClick={() => setQuantity((q) => Math.min(maxQty, q + 1))} disabled={quantity >= maxQty} aria-label="Increase quantity">
              <Plus className="size-4" />
            </button>
          </div>
          {variant && variant.tracked && variant.available > 0 && variant.available <= 5 && <span className="text-sm text-warning">Only {variant.available} left</span>}
        </div>

        {variant && variant.available <= 0 ? (
          <Alert tone="warning" title="Out of stock">This option is currently unavailable. Message us on WhatsApp and we&apos;ll let you know when it&apos;s back.</Alert>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <SubmitButton size="lg" name="intent" value="cart" disabled={!variant} pendingLabel="Adding…">
              <ShoppingBag className="size-5" /> Add to cart
            </SubmitButton>
            <SubmitButton size="lg" variant="secondary" name="intent" value="buy" disabled={!variant} pendingLabel="One moment…">
              <Zap className="size-5" /> Buy now
            </SubmitButton>
          </div>
        )}
        {state?.ok && (
          <Alert tone="success">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="flex items-center gap-1.5"><Check className="size-4" /> {state.message}</span>
              <Link href="/cart" className="font-semibold text-white underline underline-offset-4">View cart</Link>
              <Link href="/checkout" className="font-semibold text-white underline underline-offset-4">Checkout</Link>
            </span>
          </Alert>
        )}
        {state && !state.ok && <Alert tone="danger">{state.error}</Alert>}
      </form>

      <a href={inquiry} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "lg", "w-full")}>
        <WhatsAppIcon className="size-5" /> Ask about this on WhatsApp
      </a>
    </div>
  );
}
