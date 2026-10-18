import { Readable } from "node:stream";
import path from "node:path";
import { storedFileInfo } from "@/lib/storage";

const TYPES: Record<string, string> = { ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Serves public media (product images, banners, logo). Private files (digital goods, payment proofs) are never reachable here. */
export async function GET(_request: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const { key } = await params;
  const rel = key.join("/");
  const ext = path.extname(rel).toLowerCase();
  if (!TYPES[ext] || !/^[A-Za-z0-9/_.-]+$/.test(rel) || rel.includes("..")) return new Response("Not found", { status: 404 });
  const file = await storedFileInfo(`public/${rel}`).catch(() => null);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(Readable.toWeb(file.stream()) as ReadableStream, {
    headers: { "Content-Type": TYPES[ext], "Content-Length": String(file.size), "Cache-Control": "public, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" },
  });
}
