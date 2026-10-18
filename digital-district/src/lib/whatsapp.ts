// WhatsApp click-to-chat helpers. Opening WhatsApp proves nothing about payment or delivery:
// orders created this way stay "Pending confirmation" until staff confirm them.
import { formatMoney } from "./money";

export function waLink(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Fallback for desktop browsers where wa.me is blocked: WhatsApp Web's own endpoint. */
export function waWebLink(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://api.whatsapp.com/send?phone=${digits}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
}

export type WhatsAppOrder = {
  number: string;
  customerName: string;
  phone: string;
  currency: string;
  items: { productTitle: string; variantName: string; quantity: number; unitPrice: number; lineTotal: number; customFields?: Record<string, string> }[];
  subtotal: number;
  discountTotal: number;
  couponCode?: string | null;
  shippingTotal: number;
  taxTotal: number;
  taxInclusive: boolean;
  total: number;
  requiresShipping: boolean;
  deliveryMethod: "NONE" | "DELIVERY" | "PICKUP";
  shipCity?: string | null;
  shipArea?: string | null;
  shipAddress?: string | null;
  paymentMethodName?: string | null;
  customerNote?: string | null;
  orderUrl?: string;
};

export function orderWhatsAppMessage(o: WhatsAppOrder): string {
  const m = (c: number) => formatMoney(c, o.currency);
  const lines: string[] = [];
  lines.push("Hello Digital District, I would like to confirm my order.");
  lines.push("");
  lines.push(`Order reference: ${o.number}`);
  lines.push("");
  for (const i of o.items) {
    const variant = i.variantName && i.variantName !== "Default" ? ` (${i.variantName})` : "";
    lines.push(`• ${i.productTitle}${variant} × ${i.quantity} — ${m(i.unitPrice * i.quantity)}`);
    for (const [k, v] of Object.entries(i.customFields ?? {})) lines.push(`   ${k}: ${v}`);
  }
  lines.push("");
  lines.push(`Subtotal: ${m(o.subtotal)}`);
  const couponDiscount = o.items.reduce((s, i) => s + (i.unitPrice * i.quantity - i.lineTotal), 0);
  if (couponDiscount > 0) lines.push(`Discount${o.couponCode ? ` (${o.couponCode})` : ""}: -${m(couponDiscount)}`);
  if (o.requiresShipping) lines.push(o.deliveryMethod === "PICKUP" ? "Delivery: Pickup" : `Delivery: ${o.shippingTotal > 0 ? m(o.shippingTotal) : "Free"}`);
  if (o.taxTotal > 0) lines.push(o.taxInclusive ? `Includes tax: ${m(o.taxTotal)}` : `Tax: ${m(o.taxTotal)}`);
  lines.push(`Total: ${m(o.total)}`);
  lines.push("");
  lines.push(`Name: ${o.customerName}`);
  lines.push(`Phone: +${o.phone}`);
  if (o.requiresShipping && o.deliveryMethod === "DELIVERY") {
    lines.push(`Address: ${[o.shipAddress, o.shipArea, o.shipCity].filter(Boolean).join(", ")}`);
  }
  if (o.paymentMethodName) lines.push(`Payment: ${o.paymentMethodName}`);
  if (o.customerNote) lines.push(`Note: ${o.customerNote}`);
  if (o.orderUrl) {
    lines.push("");
    lines.push(`Order page: ${o.orderUrl}`);
  }
  return lines.join("\n");
}

export function productInquiryMessage(title: string, url: string, variant?: string) {
  return `Hello Digital District, I'm interested in ${title}${variant ? ` (${variant})` : ""}. Is it available?\n${url}`;
}
