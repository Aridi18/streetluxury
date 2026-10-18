// Pure URL helpers for stored media (safe to import from client components).

export const IMAGE_SIZES = [400, 800, 1600] as const;

export function imageUrl(key: string | null | undefined, size: (typeof IMAGE_SIZES)[number] = 800): string | null {
  if (!key) return null;
  return `/media/${key.replace(/^public\//, "")}-${size}.webp`;
}

export function imageSrcSet(key: string): string {
  return IMAGE_SIZES.map((s) => `${imageUrl(key, s)} ${s}w`).join(", ");
}

export function publicFileUrl(key: string | null | undefined): string | null {
  if (!key) return null;
  return `/media/${key.replace(/^public\//, "")}`;
}
