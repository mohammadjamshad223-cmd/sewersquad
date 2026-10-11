import "server-only";
import { prisma } from "../db";
import { rateLimited } from "../errors";

/**
 * Fixed-window rate limiter stored in Postgres so it works across serverless instances.
 * Returns remaining attempts; throws AppError(RATE_LIMITED) when exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart") VALUES (${key}, 1, now())
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(secs => ${windowSeconds}) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  const count = rows[0]?.count ?? 1;
  if (count > limit) throw rateLimited();
  return limit - count;
}

export async function clearRateLimit(key: string) {
  await prisma.rateLimitBucket.deleteMany({ where: { key } });
}
