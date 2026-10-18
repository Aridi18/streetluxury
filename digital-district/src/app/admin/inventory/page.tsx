import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import Link from "next/link";
import { Download } from "lucide-react";
import { db } from "@/lib/db";
import { requireStaffPage } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { adjustStockAction } from "@/app/admin/_actions/inventory";
import { ActionForm } from "@/components/action-form";
import { PageHeader, Panel, Stat, Table, fmtDateTime } from "@/components/admin/ui";
import { Button, Input, Select, buttonClass } from "@/components/ui";

export const metadata: Metadata = { title: "Inventory" };

const REASONS: Record<string, string> = {
  ORDER_PLACED: "Order placed", ORDER_CANCELLED: "Order cancelled", RETURN_RESTOCK: "Return restocked", PURCHASE_RECEIVED: "Purchase received",
  MANUAL_ADJUSTMENT: "Manual adjustment", STOCK_COUNT: "Stock count", DAMAGED: "Damaged / lost", LICENSE_KEYS_ADDED: "Licence keys added", LICENSE_KEYS_REMOVED: "Licence keys removed",
};

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; low?: string }> }) {
  await requireStaffPage("inventory.manage");
  const sp = await searchParams;
  const where: Prisma.ProductVariantWhereInput = {
    deletedAt: null,
    trackInventory: true,
    product: { deletedAt: null },
    ...(sp.q ? { OR: [{ sku: { contains: sp.q, mode: "insensitive" } }, { name: { contains: sp.q, mode: "insensitive" } }, { product: { title: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [variantsAll, movements] = await Promise.all([
    db.productVariant.findMany({ where, include: { product: { select: { id: true, title: true } } }, orderBy: [{ stockOnHand: "asc" }, { sku: "asc" }], take: 300 }),
    db.inventoryMovement.findMany({ orderBy: { createdAt: "desc" }, take: 60, include: { variant: { select: { sku: true, name: true, product: { select: { title: true } } } } } }),
  ]);
  const variants = sp.low ? variantsAll.filter((v) => v.stockOnHand <= v.lowStockThreshold) : variantsAll;
  const units = variantsAll.reduce((s, v) => s + Math.max(0, v.stockOnHand), 0);
  const value = variantsAll.reduce((s, v) => s + Math.max(0, v.stockOnHand) * v.costPrice, 0);
  const low = variantsAll.filter((v) => v.stockOnHand <= v.lowStockThreshold).length;
  const actors = new Map((await db.user.findMany({ where: { id: { in: movements.map((m) => m.actorId).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return (
    <div>
      <PageHeader title="Inventory" description="Stock for products with “track stock” on. Every change is recorded below." actions={<a href="/api/admin/export/inventory" className={buttonClass("secondary", "sm")}><Download className="size-4" /> Export CSV</a>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tracked items" value={variantsAll.length} />
        <Stat label="Units in stock" value={units} />
        <Stat label="Stock value at cost" value={formatMoney(value)} />
        <Stat label="Low or out of stock" value={low} tone={low ? "warn" : undefined} />
      </div>
      <form method="get" className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={sp.q} placeholder="Search product or SKU…" className="h-10 max-w-sm" />
        <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" name="low" value="1" defaultChecked={Boolean(sp.low)} className="accent-brand-500" /> Low stock only</label>
        <Button size="sm" className="h-10">Filter</Button>
      </form>
      <Table className="mb-8">
        <thead><tr><th>Product</th><th>SKU</th><th className="text-right">In stock</th><th className="text-right">Avg. cost</th><th>Adjust</th></tr></thead>
        <tbody>
          {variants.map((v) => (
            <tr key={v.id}>
              <td><Link href={`/admin/products/${v.product.id}`} className="font-semibold text-white hover:text-brand-200">{v.product.title}</Link>{v.name !== "Default" && <p className="text-xs text-subtle">{v.name}</p>}</td>
              <td className="font-mono text-xs">{v.sku}</td>
              <td className={`text-right font-semibold ${v.stockOnHand <= 0 ? "text-danger" : v.stockOnHand <= v.lowStockThreshold ? "text-warning" : "text-white"}`}>{v.stockOnHand}</td>
              <td className="text-right">{formatMoney(v.costPrice)}</td>
              <td>
                <details>
                  <summary className="cursor-pointer text-xs font-semibold text-brand-300">Change</summary>
                  <ActionForm action={adjustStockAction} submitLabel="Apply" submitVariant="secondary" className="mt-2 w-72 space-y-2">
                    <input type="hidden" name="variantId" value={v.id} />
                    <Select name="reason" className="h-9 text-sm" aria-label="Reason">
                      <option value="STOCK_COUNT">Stock count — set exact quantity</option>
                      <option value="MANUAL_ADJUSTMENT">Add / remove units (+5 / −2)</option>
                      <option value="DAMAGED">Damaged or lost (enter −N)</option>
                    </Select>
                    <Input name="value" inputMode="numeric" required placeholder="Quantity" className="h-9" />
                    <Input name="note" required placeholder="Why? (required)" className="h-9" />
                  </ActionForm>
                </details>
              </td>
            </tr>
          ))}
          {!variants.length && <tr><td colSpan={5} className="py-8 text-center text-subtle">No tracked stock. Turn on “Track stock” for physical products in the product editor.</td></tr>}
        </tbody>
      </Table>
      <Panel title="Stock movements" bodyClassName="p-0">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-subtle"><tr className="border-b border-line"><th className="px-5 py-2.5">When</th><th className="px-3 py-2.5">Item</th><th className="px-3 py-2.5">Reason</th><th className="px-3 py-2.5 text-right">Change</th><th className="px-3 py-2.5 text-right">After</th><th className="px-5 py-2.5">By / note</th></tr></thead>
          <tbody>
            {movements.map((mv) => (
              <tr key={mv.id} className="border-b border-line/60 last:border-0">
                <td className="px-5 py-2 text-xs text-subtle">{fmtDateTime(mv.createdAt)}</td>
                <td className="px-3 py-2">{mv.variant.product.title}{mv.variant.name !== "Default" ? ` — ${mv.variant.name}` : ""}</td>
                <td className="px-3 py-2 text-muted">{REASONS[mv.reason]}{mv.orderId && <> · <Link href={`/admin/orders/${mv.orderId}`} className="text-brand-300">order</Link></>}</td>
                <td className={`px-3 py-2 text-right font-semibold ${mv.delta < 0 ? "text-danger" : "text-success"}`}>{mv.delta > 0 ? `+${mv.delta}` : mv.delta}</td>
                <td className="px-3 py-2 text-right">{mv.quantityAfter}</td>
                <td className="px-5 py-2 text-xs text-subtle">{mv.actorId ? actors.get(mv.actorId) : "System"}{mv.note ? ` · ${mv.note}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
