import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getCartView } from "@/lib/cart";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { mpgsConfigured } from "@/lib/payments";
import { CheckoutForm } from "@/components/store/checkout-form";
import { ProductImage } from "@/components/store/product-image";
import { Alert, LinkButton } from "@/components/ui";

export const metadata: Metadata = { title: "Checkout", robots: { index: false } };

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const mode = (await searchParams).mode === "whatsapp" ? "whatsapp" : "website";
  const [view, user] = await Promise.all([getCartView(), getCurrentUser()]);
  const { items, totals, issues, zones, settings, deliveryQuotes, couponCode } = view;
  if (items.length === 0) redirect("/cart");
  if (!user && !settings.guestCheckout) redirect("/login?next=/checkout");
  const m = (c: number) => formatMoney(c, settings.currency);

  const methods = (await db.paymentMethod.findMany({ where: { isEnabled: true }, orderBy: { sortOrder: "asc" } })).filter((pm) => {
    if (pm.kind === "ONLINE_CARD" && !mpgsConfigured()) return false;
    if (pm.appliesTo === "PHYSICAL_ONLY" && !totals.requiresShipping) return false;
    if (pm.appliesTo === "DIGITAL_ONLY" && totals.requiresShipping) return false;
    return true;
  });
  const address = user ? await db.address.findFirst({ where: { userId: user.id }, orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] }) : null;

  const summary = (
    <div className="space-y-3">
      <ul className="max-h-72 space-y-3 overflow-y-auto pr-1">
        {items.map((item) => {
          const line = totals.lines.find((l) => l.key === item.id)!;
          return (
            <li key={item.id} className="flex gap-3">
              <div className="relative size-14 shrink-0 overflow-hidden rounded-lg">
                <ProductImage imageKey={item.variant.product.images[0]?.key ?? null} alt="" title={item.variant.product.title} sizes="56px" />
                <span className="absolute right-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-black/80 px-1 text-[10px] font-bold">{item.quantity}</span>
              </div>
              <div className="min-w-0 flex-1 text-sm">
                <p className="truncate font-semibold">{item.variant.product.title}</p>
                {item.variant.name !== "Default" && <p className="text-xs text-muted">{item.variant.name}</p>}
              </div>
              <p className="text-sm font-semibold">{m(line.lineSubtotal)}</p>
            </li>
          );
        })}
      </ul>
      <dl className="space-y-2 border-t border-line pt-3 text-sm">
        <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{m(totals.listSubtotal)}</dd></div>
        {totals.saleDiscount > 0 && <div className="flex justify-between"><dt className="text-muted">Sale savings</dt><dd className="text-success">−{m(totals.saleDiscount)}</dd></div>}
        {totals.couponDiscount > 0 && <div className="flex justify-between"><dt className="text-muted">Code {couponCode}</dt><dd className="text-success">−{m(totals.couponDiscount)}</dd></div>}
      </dl>
      {couponCode && totals.coupon.error && <Alert tone="warning">Code {couponCode}: {totals.coupon.error} <Link href="/cart" className="underline">Remove it in your cart</Link>.</Alert>}
    </div>
  );

  return (
    <div className="container-page py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow mb-2">{mode === "whatsapp" ? "Order via WhatsApp" : "Secure checkout"}</p>
          <h1 className="text-3xl font-bold text-white sm:text-4xl">Checkout</h1>
        </div>
        <div className="flex gap-2 text-sm">
          {mode === "whatsapp" ? <LinkButton href="/checkout" variant="outline" size="sm">Check out on the website instead</LinkButton> : <LinkButton href="/checkout?mode=whatsapp" variant="outline" size="sm">Order via WhatsApp instead</LinkButton>}
        </div>
      </div>
      {!user && (
        <p className="mb-6 text-sm text-muted">
          Checking out as a guest. <Link href="/login?next=/checkout" className="font-semibold text-brand-300">Sign in</Link> to save your order history and addresses.
        </p>
      )}
      {issues.length > 0 ? (
        <Alert tone="warning" title="Some items in your cart need attention">
          <Link href="/cart" className="underline">Return to your cart</Link> to fix them before checking out.
        </Alert>
      ) : (
        <CheckoutForm
          mode={mode}
          idempotencyKey={randomUUID()}
          requiresShipping={totals.requiresShipping}
          currency={settings.currency}
          zones={zones.map((z) => ({ id: z.id, name: z.name, fee: z.fee, areas: z.areas, estimatedDelivery: z.estimatedDelivery, freeShippingThreshold: z.freeShippingThreshold }))}
          pickup={{ enabled: settings.pickupEnabled, address: settings.pickupAddress, instructions: settings.pickupInstructions }}
          quotes={deliveryQuotes}
          paymentMethods={methods.map((pm) => ({ id: pm.id, name: pm.name, description: pm.description, kind: pm.kind }))}
          defaults={{
            name: user?.name ?? "",
            email: user?.email ?? "",
            phone: user?.phone ? formatPhone(user.phone) : address ? formatPhone(address.phone) : "",
            city: address?.city ?? "",
            area: address?.area ?? "",
            address: address?.addressLine ?? "",
            instructions: address?.instructions ?? "",
            zoneId: "",
          }}
          signedIn={Boolean(user)}
          taxLabel={settings.taxEnabled ? settings.taxName : null}
          taxInclusive={settings.taxInclusive}
          summary={summary}
        />
      )}
    </div>
  );
}
