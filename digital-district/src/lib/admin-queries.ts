import type { OrderStatus, PaymentStatus, Prisma } from "@prisma/client";
import { normalizePhone } from "./phone";
import { zonedMidnight, addDaysYmd } from "./time";

export type OrderFilters = { q?: string; status?: string; payment?: string; source?: string; type?: string; from?: string; to?: string; delivery?: string };

const OPEN_STATUSES: OrderStatus[] = ["CONFIRMED", "PROCESSING", "PARTIALLY_FULFILLED", "SHIPPED", "READY_FOR_PICKUP"];

/** Builds the order search used by both the orders table and its CSV export. */
export function orderWhere(f: OrderFilters): Prisma.OrderWhereInput {
  const and: Prisma.OrderWhereInput[] = [];
  const q = f.q?.trim();
  if (q) {
    const phone = normalizePhone(q);
    and.push({
      OR: [
        { number: { contains: q, mode: "insensitive" } },
        { customerName: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { phone: { contains: q.replace(/\D/g, "") || q } },
        ...(phone ? [{ phone }] : []),
        { items: { some: { OR: [{ productTitle: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } } },
      ],
    });
  }
  if (f.status === "open") and.push({ status: { in: OPEN_STATUSES } });
  else if (f.status) and.push({ status: f.status as OrderStatus });
  if (f.payment === "open") and.push({ paymentStatus: { in: ["UNPAID", "PENDING_VERIFICATION", "PARTIALLY_PAID", "FAILED"] }, status: { not: "CANCELLED" } });
  else if (f.payment) and.push({ paymentStatus: f.payment as PaymentStatus });
  if (f.source === "WEBSITE" || f.source === "WHATSAPP" || f.source === "ADMIN") and.push({ source: f.source });
  if (f.type === "physical") and.push({ requiresShipping: true });
  if (f.type === "digital") and.push({ hasDigital: true });
  if (f.delivery === "pending") and.push({ deliveries: { some: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } } }, status: { not: "CANCELLED" } });
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) and.push({ placedAt: { gte: zonedMidnight(f.from) } });
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) and.push({ placedAt: { lt: zonedMidnight(addDaysYmd(f.to, 1)) } });
  return and.length ? { AND: and } : {};
}
