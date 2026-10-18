/** An error whose message is safe to show to the user. Anything else is logged and replaced with a generic message. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export function toActionError(err: unknown): { ok: false; error: string } {
  if (err instanceof UserError) return { ok: false, error: err.message };
  if (err instanceof Error && err.name === "ForbiddenError") return { ok: false, error: err.message };
  // Let Next.js navigation signals (redirect/notFound) propagate.
  if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string") {
    const digest = (err as { digest: string }).digest;
    if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR") || digest === "NEXT_NOT_FOUND") throw err;
  }
  console.error(err);
  return { ok: false, error: "Something went wrong. Please try again." };
}
