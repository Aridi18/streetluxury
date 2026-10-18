import "server-only";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import sharp, { type Metadata } from "sharp";
import { randomToken } from "./crypto";
import { env } from "./env";
import { UserError } from "./errors";
import { IMAGE_SIZES } from "./media";

export { IMAGE_SIZES, imageUrl, imageSrcSet, publicFileUrl } from "./media";

// Storage layout (outside the web root):
//   public/...   product images, banners, logo — served by /media/[...key]
//   private/...  digital product files and payment proofs — only served through authorised routes

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PROOF_BYTES = 8 * 1024 * 1024;
const MAX_DIGITAL_FILE_BYTES = 500 * 1024 * 1024;

function root() {
  return path.resolve(env.storageDir);
}

/** Resolves a storage key to an absolute path, refusing anything that escapes the storage root. */
export function resolveKey(key: string): string {
  if (!/^(public|private)\/[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new Error("Invalid storage key");
  return full;
}

async function put(key: string, data: Buffer) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o640 });
}

function datedPrefix(area: "public" | "private", folder: string) {
  const d = new Date();
  return `${area}/${folder}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${randomToken(12)}`;
}

/**
 * Validates an uploaded image by decoding it (not by trusting its name or type), strips metadata,
 * and stores 400/800/1600px WebP renditions. Returns the key prefix used by imageUrl().
 */
export async function saveProductImage(file: File, folder = "products") {
  if (file.size === 0) throw new UserError("The image file is empty.");
  if (file.size > MAX_IMAGE_BYTES) throw new UserError("Images must be 15 MB or smaller.");
  const input = Buffer.from(await file.arrayBuffer());
  let meta: Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    throw new UserError("That file is not a supported image (use JPG, PNG, WebP or AVIF).");
  }
  if (!meta.format || !["jpeg", "png", "webp", "avif", "gif", "heif"].includes(meta.format)) {
    throw new UserError("That file is not a supported image (use JPG, PNG, WebP or AVIF).");
  }
  const key = datedPrefix("public", folder);
  for (const size of IMAGE_SIZES) {
    const out = await sharp(input).rotate().resize({ width: size, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    await put(`${key}-${size}.webp`, out);
  }
  const final = await sharp(input).rotate().resize({ width: 1600, withoutEnlargement: true }).metadata();
  return { key, width: final.width ?? meta.width ?? null, height: final.height ?? meta.height ?? null };
}

/** Stores an image byte-for-byte (used for the brand logo, which must never be altered). */
export async function saveOriginalImage(file: File, folder = "brand") {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) throw new UserError("The logo must be between 1 byte and 15 MB.");
  const input = Buffer.from(await file.arrayBuffer());
  let format: string | undefined;
  try {
    format = (await sharp(input).metadata()).format;
  } catch {
    format = undefined;
  }
  const ext = format === "jpeg" ? "jpg" : format;
  if (!ext || !["png", "jpg", "webp"].includes(ext)) throw new UserError("Upload the logo as PNG, JPG or WebP.");
  const key = `${datedPrefix("public", folder)}.${ext}`;
  await put(key, input);
  return key;
}

function sniffProof(buf: Buffer): string | null {
  if (buf.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

/** Payment proof upload: JPG, PNG, WebP or PDF, max 8 MB, identified by content. Stored privately. */
export async function savePaymentProof(file: File) {
  if (file.size === 0) throw new UserError("The file is empty.");
  if (file.size > MAX_PROOF_BYTES) throw new UserError("Payment proofs must be 8 MB or smaller.");
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = sniffProof(buf);
  if (!mime) throw new UserError("Upload a screenshot or receipt as JPG, PNG, WebP or PDF.");
  const key = datedPrefix("private", "proofs");
  await put(key, buf);
  return { key, mimeType: mime };
}

/** Digital product file (any type), stored privately. */
export async function saveDigitalFile(file: File) {
  if (file.size === 0) throw new UserError("The file is empty.");
  if (file.size > MAX_DIGITAL_FILE_BYTES) throw new UserError("Files must be 500 MB or smaller.");
  const key = datedPrefix("private", "digital");
  await put(key, Buffer.from(await file.arrayBuffer()));
  const safeName = file.name.replace(/[^\w.\- ()]+/g, "_").slice(0, 150) || "download";
  return { key, fileName: safeName, mimeType: file.type || "application/octet-stream", size: file.size };
}

export async function readStored(key: string) {
  return readFile(resolveKey(key));
}

export async function storedFileInfo(key: string) {
  const full = resolveKey(key);
  const s = await stat(full);
  return { size: s.size, stream: () => createReadStream(full) };
}

export async function deleteStored(key: string) {
  await rm(resolveKey(key), { force: true });
}

export async function deleteImageRenditions(key: string) {
  for (const size of IMAGE_SIZES) await deleteStored(`${key}-${size}.webp`).catch(() => undefined);
}
