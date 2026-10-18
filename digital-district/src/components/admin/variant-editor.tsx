"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button, Input, cn } from "../ui";

export type VariantRow = {
  id?: string;
  name: string;
  optionValues: Record<string, string>;
  sku: string;
  price: string;
  compareAtPrice: string;
  costPrice: string;
  trackInventory: boolean;
  stock?: number;
  initialStock: string;
  allowBackorder: boolean;
  lowStockThreshold: string;
  durationDays: string;
  weightGrams: string;
  isActive: boolean;
};

const blank = (track: boolean): VariantRow => ({ name: "", optionValues: {}, sku: "", price: "", compareAtPrice: "", costPrice: "", trackInventory: track, initialStock: "", allowBackorder: false, lowStockThreshold: "3", durationDays: "", weightGrams: "", isActive: true });

/**
 * Edits a product's options (variants). Option names (e.g. "Plan", or "Color" + "Storage") are shared;
 * each row sets its values, price, cost and stock. The variant name is built from the values automatically.
 */
export function VariantEditor({ initial, initialOptionNames, physical }: { initial: VariantRow[]; initialOptionNames: string[]; physical: boolean }) {
  const [optionNames, setOptionNames] = useState<string[]>(initialOptionNames);
  const [rows, setRows] = useState<VariantRow[]>(initial.length ? initial : [blank(physical)]);
  const update = (i: number, patch: Partial<VariantRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  const setValue = (i: number, opt: string, value: string) =>
    setRows((r) => r.map((row, j) => {
      if (j !== i) return row;
      const optionValues = { ...row.optionValues, [opt]: value };
      return { ...row, optionValues, name: optionNames.map((n) => optionValues[n]).filter(Boolean).join(" / ") || row.name };
    }));
  const move = (i: number, d: number) => setRows((r) => {
    const n = [...r];
    const [x] = n.splice(i, 1);
    n.splice(Math.max(0, Math.min(n.length, i + d)), 0, x);
    return n;
  });
  const payload = rows.map((r) => ({ ...r, name: optionNames.length ? optionNames.map((n) => r.optionValues[n]).filter(Boolean).join(" / ") || r.name : rows.length === 1 ? r.name || "Default" : r.name, optionValues: Object.fromEntries(optionNames.map((n) => [n, r.optionValues[n] ?? ""]).filter(([, v]) => v)) }));
  const cell = "h-9 text-sm";
  return (
    <div className="space-y-4">
      <input type="hidden" name="variantsJson" value={JSON.stringify(payload)} />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Option names:</span>
        {optionNames.map((n, i) => (
          <span key={i} className="flex items-center gap-1">
            <Input value={n} onChange={(e) => setOptionNames((o) => o.map((x, j) => (j === i ? e.target.value : x)))} className="h-8 w-32 text-sm" aria-label={`Option name ${i + 1}`} />
            <button type="button" onClick={() => setOptionNames((o) => o.filter((_, j) => j !== i))} className="text-subtle hover:text-danger" aria-label="Remove option name"><Trash2 className="size-3.5" /></button>
          </span>
        ))}
        {optionNames.length < 3 && <Button type="button" size="sm" variant="ghost" onClick={() => setOptionNames((o) => [...o, o.length === 0 ? "Plan" : ""])}><Plus className="size-3.5" /> Add option name</Button>}
        <span className="text-xs text-subtle">e.g. “Plan” for subscriptions, or “Color” and “Storage” for phones. Leave empty for a single-price product.</span>
      </div>
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id ?? `new-${i}`} className={cn("rounded-xl border bg-surface-2 p-3", r.isActive ? "border-line" : "border-dashed border-line-strong opacity-70")}>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(160px,2fr)_repeat(5,minmax(0,1fr))]">
              {optionNames.length ? (
                optionNames.map((n) => (
                  <label key={n} className="text-xs text-subtle">{n || "Option"}<Input value={r.optionValues[n] ?? ""} onChange={(e) => setValue(i, n, e.target.value)} className={cell} placeholder={n === "Plan" ? "1 Month" : ""} /></label>
                ))
              ) : (
                <label className="text-xs text-subtle">Name<Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} className={cell} placeholder={rows.length === 1 ? "Default" : "e.g. 1 Month"} /></label>
              )}
              <label className="text-xs text-subtle">Price (USD) *<Input value={r.price} onChange={(e) => update(i, { price: e.target.value })} inputMode="decimal" className={cell} required /></label>
              <label className="text-xs text-subtle">Was price<Input value={r.compareAtPrice} onChange={(e) => update(i, { compareAtPrice: e.target.value })} inputMode="decimal" className={cell} placeholder="optional" /></label>
              <label className="text-xs text-subtle">Cost price<Input value={r.costPrice} onChange={(e) => update(i, { costPrice: e.target.value })} inputMode="decimal" className={cell} placeholder="what it costs you" /></label>
              <label className="text-xs text-subtle">SKU<Input value={r.sku} onChange={(e) => update(i, { sku: e.target.value })} className={cell} placeholder="auto" /></label>
              <label className="text-xs text-subtle">Duration (days)<Input value={r.durationDays} onChange={(e) => update(i, { durationDays: e.target.value })} inputMode="numeric" className={cell} placeholder="e.g. 30" /></label>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted">
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.trackInventory} onChange={(e) => update(i, { trackInventory: e.target.checked })} className="accent-brand-500" /> Track stock</label>
              {r.trackInventory && (r.id ? <span>In stock: <strong className="text-white">{r.stock ?? 0}</strong> (change it in Inventory)</span> : <label className="flex items-center gap-1.5">Starting stock <Input value={r.initialStock} onChange={(e) => update(i, { initialStock: e.target.value })} inputMode="numeric" className="h-7 w-20 text-xs" /></label>)}
              {r.trackInventory && <label className="flex items-center gap-1.5">Low-stock alert at <Input value={r.lowStockThreshold} onChange={(e) => update(i, { lowStockThreshold: e.target.value })} inputMode="numeric" className="h-7 w-16 text-xs" /></label>}
              {r.trackInventory && <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.allowBackorder} onChange={(e) => update(i, { allowBackorder: e.target.checked })} className="accent-brand-500" /> Allow backorders</label>}
              {physical && <label className="flex items-center gap-1.5">Weight (g) <Input value={r.weightGrams} onChange={(e) => update(i, { weightGrams: e.target.value })} inputMode="numeric" className="h-7 w-20 text-xs" /></label>}
              <label className="flex items-center gap-1.5"><input type="checkbox" checked={r.isActive} onChange={(e) => update(i, { isActive: e.target.checked })} className="accent-brand-500" /> Available for sale</label>
              <span className="ml-auto flex items-center gap-1">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1 hover:bg-surface-3 disabled:opacity-30" aria-label="Move up"><ArrowUp className="size-3.5" /></button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="rounded p-1 hover:bg-surface-3 disabled:opacity-30" aria-label="Move down"><ArrowDown className="size-3.5" /></button>
                <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} disabled={rows.length === 1} className="rounded p-1 text-danger hover:bg-surface-3 disabled:opacity-30" aria-label="Remove option"><Trash2 className="size-3.5" /></button>
              </span>
            </div>
          </div>
        ))}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, blank(physical)])}><Plus className="size-4" /> Add another option / price</Button>
    </div>
  );
}

export type CustomFieldRow = { label: string; type: string; required: boolean; options: string };

export function CustomFieldsEditor({ initial }: { initial: CustomFieldRow[] }) {
  const [rows, setRows] = useState<CustomFieldRow[]>(initial);
  const update = (i: number, patch: Partial<CustomFieldRow>) => setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  return (
    <div className="space-y-2">
      <input type="hidden" name="customFieldsJson" value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-2 p-2 text-sm">
          <Input value={r.label} onChange={(e) => update(i, { label: e.target.value })} placeholder="Question, e.g. Email to activate on" className="h-9 min-w-48 flex-1" aria-label="Question" />
          <select value={r.type} onChange={(e) => update(i, { type: e.target.value })} className="h-9 rounded-lg border border-line-strong bg-surface px-2" aria-label="Answer type">
            <option value="text">Short text</option><option value="email">Email</option><option value="textarea">Long text</option><option value="select">Choice</option>
          </select>
          {r.type === "select" && <Input value={r.options} onChange={(e) => update(i, { options: e.target.value })} placeholder="Choices, comma separated" className="h-9 w-56" aria-label="Choices" />}
          <label className="flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" checked={r.required} onChange={(e) => update(i, { required: e.target.checked })} className="accent-brand-500" /> Required</label>
          <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="p-1 text-danger" aria-label="Remove question"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => [...r, { label: "", type: "text", required: true, options: "" }])}><Plus className="size-4" /> Add a question for the customer</Button>
    </div>
  );
}
