"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button, Input } from "../ui";

export function PurchaseItemsEditor({ variants }: { variants: { id: string; label: string; cost: string }[] }) {
  const [rows, setRows] = useState([{ variantId: "", quantity: "1", unitCost: "" }]);
  const update = (i: number, patch: Partial<(typeof rows)[number]>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <div className="space-y-2">
      <input type="hidden" name="itemsJson" value={JSON.stringify(rows)} />
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select value={r.variantId} onChange={(e) => update(i, { variantId: e.target.value, unitCost: r.unitCost || variants.find((v) => v.id === e.target.value)?.cost || "" })} className="h-10 min-w-64 flex-1 rounded-xl border border-line-strong bg-surface-2 px-3 text-sm" aria-label="Product">
            <option value="">Choose a product…</option>
            {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
          </select>
          <Input value={r.quantity} onChange={(e) => update(i, { quantity: e.target.value })} inputMode="numeric" className="h-10 w-24" aria-label="Quantity" placeholder="Qty" />
          <Input value={r.unitCost} onChange={(e) => update(i, { unitCost: e.target.value })} inputMode="decimal" className="h-10 w-32" aria-label="Unit cost (USD)" placeholder="Unit cost $" />
          <button type="button" onClick={() => setRows((x) => (x.length > 1 ? x.filter((_, j) => j !== i) : x))} className="p-2 text-danger" aria-label="Remove line"><Trash2 className="size-4" /></button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => [...r, { variantId: "", quantity: "1", unitCost: "" }])}><Plus className="size-4" /> Add line</Button>
    </div>
  );
}
