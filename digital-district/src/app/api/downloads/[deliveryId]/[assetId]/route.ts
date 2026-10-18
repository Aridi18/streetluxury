import { Readable } from "node:stream";
import { db } from "@/lib/db";
import { getCurrentUser, clientInfo } from "@/lib/auth";
import { verifyOrderAccessKey } from "@/lib/order-core";
import { hasPermission } from "@/lib/permissions";
import { storedFileInfo } from "@/lib/storage";

/** Authorised, logged and limited download of a purchased digital file. Files are never publicly reachable. */
export async function GET(request: Request, { params }: { params: Promise<{ deliveryId: string; assetId: string }> }) {
  const { deliveryId, assetId } = await params;
  const key = new URL(request.url).searchParams.get("key");
  const delivery = await db.digitalDelivery.findUnique({ where: { id: deliveryId }, include: { order: true } });
  if (!delivery) return new Response("Not found", { status: 404 });
  const user = await getCurrentUser();
  const isStaff = Boolean(user && hasPermission(user.role, "orders.view"));
  const allowed = isStaff || (user && delivery.order.userId === user.id) || verifyOrderAccessKey(delivery.orderId, key);
  if (!allowed) return new Response("Not found", { status: 404 });
  if (!isStaff) {
    if (delivery.status !== "DELIVERED") return new Response("This item has not been delivered yet.", { status: 403 });
    if (!["PAID", "PARTIALLY_REFUNDED"].includes(delivery.order.paymentStatus)) return new Response("This order is not paid.", { status: 403 });
    if (delivery.downloadExpiresAt && delivery.downloadExpiresAt < new Date()) return new Response("This download link has expired. Please contact us for a new one.", { status: 410 });
    if (delivery.maxDownloads != null && delivery.downloadCount >= delivery.maxDownloads) return new Response("The download limit for this item has been reached. Please contact us.", { status: 429 });
  }
  if (!delivery.assetIds.includes(assetId)) return new Response("Not found", { status: 404 });
  const asset = await db.digitalAsset.findUnique({ where: { id: assetId } });
  if (!asset) return new Response("Not found", { status: 404 });
  const file = await storedFileInfo(asset.fileKey).catch(() => null);
  if (!file) return new Response("File unavailable. Please contact us.", { status: 404 });
  if (!isStaff) {
    const { ip } = await clientInfo();
    await db.$transaction([
      db.digitalDelivery.update({ where: { id: deliveryId }, data: { downloadCount: { increment: 1 } } }),
      db.downloadLog.create({ data: { deliveryId, assetId, userId: user?.id, ip } }),
    ]);
  }
  return new Response(Readable.toWeb(file.stream()) as ReadableStream, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename="${asset.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
