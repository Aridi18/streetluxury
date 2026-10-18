import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bookmark, ShoppingBag, Trash2 } from "lucide-react";
import { getCartView, MAX_LINE_QUANTITY, availableQuantity } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { ProductImage } from "@/components/store/product-image";
import { AutoSubmitSelect } from "@/components/store/auto-submit-select";
import { CouponForm } from "@/components/store/coupon-form";
import { WhatsAppIcon } from "@/components/store/icons";
import { Alert, Button, EmptyState, LinkButton, buttonClass } from "@/components/ui";
import { removeCouponAction, removeItemAction, saveForLaterAction, updateQuantityAction } from "@/app/actions/cart";

export const metadata: Metadata = { title: "Your cart", robots: { index: false } };

export default async function CartPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const { items, saved, totals, issues, couponCode, settings } = await getCartView();
  const m = (c: number) => formatMoney(c, settings.currency);
  const lineFor = (id: string) => totals.lines.find((l) => l.key === id);
  return (
    <div className="container-page py-10">
      <h1 className="mb-8 text-3xl font-bold text-white sm:text-4xl">Your cart</h1>
      {error && <Alert tone="danger" className="mb-6">{error}</Alert>}
      {items.length === 0 ? (
        <EmptyState title="Your cart is empty" action={<LinkButton href="/shop">Start shopping</LinkButton>}>
          Browse the store and add the plans you need — your cart is saved for when you come back.
        </EmptyState>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
          <ul className="space-y-3">
            {items.map((item) => {
              const v = item.variant;
              const line = lineFor(item.id);
              const issue = issues.find((i) => i.itemId === item.id);
              const max = Math.max(item.quantity, Math.min(MAX_LINE_QUANTITY, availableQuantity(v)));
              const fields = Object.entries((item.customFields ?? {}) as Record<string, string>);
              return (
                <li key={item.id} className="card flex gap-4 p-4">
                  <Link href={`/product/${v.product.slug}`} className="size-24 shrink-0 overflow-hidden rounded-xl sm:size-28">
                    <ProductImage imageKey={v.product.images[0]?.key ?? null} alt={v.product.title} title={v.product.title} sizes="112px" />
                  </Link>
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/product/${v.product.slug}`} className="font-semibold text-white hover:text-brand-200">{v.product.title}</Link>
                        {v.name !== "Default" && <p className="text-sm text-muted">{v.name}</p>}
                        {fields.map(([k, val]) => <p key={k} className="text-xs text-subtle">{k}: {val}</p>)}
                        {item.customerNote && <p className="text-xs text-subtle">Note: {item.customerNote}</p>}
                      </div>
                      {line && (
                        <div className="text-right">
                          <p className="font-semibold text-white">{m(line.lineSubtotal)}</p>
                          <p className="text-xs text-subtle">
                            {m(line.unitPrice)} each {line.unitPrice < line.basePrice && <s className="ml-1">{m(line.basePrice)}</s>}
                          </p>
                        </div>
                      )}
                    </div>
                    {issue && <p className="text-sm text-warning">{issue.message}</p>}
                    <div className="mt-auto flex flex-wrap items-center gap-2">
                      <form action={updateQuantityAction} className="flex items-center gap-2">
                        <input type="hidden" name="itemId" value={item.id} />
                        <label htmlFor={`q-${item.id}`} className="sr-only">Quantity</label>
                        <AutoSubmitSelect id={`q-${item.id}`} name="quantity" defaultValue={String(item.quantity)} className="h-9 w-20 text-sm">
                          {Array.from({ length: Math.max(1, max) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                        </AutoSubmitSelect>
                        <noscript><Button size="sm" variant="secondary">Update</Button></noscript>
                      </form>
                      <form action={saveForLaterAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <input type="hidden" name="saved" value="1" />
                        <Button size="sm" variant="ghost"><Bookmark className="size-4" /> Save for later</Button>
                      </form>
                      <form action={removeItemAction}>
                        <input type="hidden" name="itemId" value={item.id} />
                        <Button size="sm" variant="ghost" className="hover:text-danger"><Trash2 className="size-4" /> Remove</Button>
                      </form>
                    </div>
                  </div>
                </li>
              );
            })}
            <li><Link href="/shop" className="inline-block pt-2 text-sm font-semibold text-brand-300 hover:text-brand-200">← Continue shopping</Link></li>
          </ul>

          <aside className="card h-fit space-y-5 p-6 lg:sticky lg:top-36">
            <h2 className="text-lg font-semibold">Order summary</h2>
            <dl className="space-y-2.5 text-sm">
              <Row label="Subtotal" value={m(totals.listSubtotal)} />
              {totals.saleDiscount > 0 && <Row label="Sale savings" value={`−${m(totals.saleDiscount)}`} accent />}
              {totals.couponDiscount > 0 && <Row label={`Code ${couponCode}`} value={`−${m(totals.couponDiscount)}`} accent />}
              {totals.requiresShipping && <Row label="Delivery" value="Calculated at checkout" muted />}
              {totals.taxTotal > 0 && <Row label={totals.taxInclusive ? `Includes ${settings.taxName}` : settings.taxName} value={m(totals.taxTotal)} muted={totals.taxInclusive} />}
            </dl>
            {couponCode ? (
              <div className="flex items-center justify-between rounded-xl border border-line-strong bg-surface-2 px-3 py-2 text-sm">
                <span>
                  <span className="font-mono font-semibold text-brand-100">{couponCode}</span>
                  {totals.coupon.error ? <span className="block text-xs text-warning">{totals.coupon.error}</span> : <span className="block text-xs text-success">Applied</span>}
                </span>
                <form action={removeCouponAction}><Button size="sm" variant="ghost">Remove</Button></form>
              </div>
            ) : (
              <CouponForm />
            )}
            <div className="flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold">Total</span>
              <span className="font-display text-2xl font-bold text-white">{m(totals.total)}</span>
            </div>
            {issues.length > 0 ? (
              <Alert tone="warning">Please fix the highlighted items before checking out.</Alert>
            ) : (
              <div className="space-y-2.5">
                <LinkButton href="/checkout" size="lg" className="w-full">Checkout <ArrowRight className="size-4" /></LinkButton>
                <Link href="/checkout?mode=whatsapp" className={buttonClass("whatsapp", "lg", "w-full")}>
                  <WhatsAppIcon className="size-5" /> Order via WhatsApp
                </Link>
                <p className="text-center text-xs text-subtle">Prices, discounts and delivery fees are confirmed on our server when you order.</p>
              </div>
            )}
          </aside>
        </div>
      )}

      {saved.length > 0 && (
        <section className="mt-12">
          <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold"><Bookmark className="size-5 text-brand-300" /> Saved for later</h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {saved.map((item) => (
              <li key={item.id} className="card flex items-center gap-4 p-4">
                <div className="size-16 shrink-0 overflow-hidden rounded-lg"><ProductImage imageKey={item.variant.product.images[0]?.key ?? null} alt="" title={item.variant.product.title} sizes="64px" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{item.variant.product.title}</p>
                  {item.variant.name !== "Default" && <p className="text-sm text-muted">{item.variant.name}</p>}
                </div>
                <form action={saveForLaterAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <input type="hidden" name="saved" value="0" />
                  <Button size="sm" variant="secondary"><ShoppingBag className="size-4" /> Move to cart</Button>
                </form>
                <form action={removeItemAction}>
                  <input type="hidden" name="itemId" value={item.id} />
                  <Button size="sm" variant="ghost" aria-label="Remove"><Trash2 className="size-4" /></Button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Row({ label, value, accent, muted }: { label: string; value: string; accent?: boolean; muted?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={accent ? "font-semibold text-success" : muted ? "text-subtle" : "text-fg"}>{value}</dd>
    </div>
  );
}
