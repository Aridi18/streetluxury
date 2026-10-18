import { db } from "@/lib/db";
import { requireStaff } from "@/lib/auth";
import { readStored } from "@/lib/storage";

/** Payment proofs are private: only staff who can verify payments may open them. */
export async function GET(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    await requireStaff("payments.verify");
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const payment = await db.payment.findUnique({ where: { id: (await params).paymentId } });
  if (!payment?.proofKey) return new Response("Not found", { status: 404 });
  const data = await readStored(payment.proofKey).catch(() => null);
  if (!data) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": payment.proofMimeType ?? "application/octet-stream",
      "Content-Disposition": "inline",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
