import { db } from "./db";
import { UserError } from "./errors";

/**
 * Fixed-window rate limiter stored in PostgreSQL, so limits hold across restarts and multiple app instances.
 * Throws a UserError when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<void> {
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "windowStart") VALUES (${key}, 1, ${windowStart})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = ${windowStart} THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = ${windowStart}
    RETURNING "count"`;
  if ((rows[0]?.count ?? 0) > limit) {
    throw new UserError("Too many attempts. Please wait a few minutes and try again.");
  }
}
