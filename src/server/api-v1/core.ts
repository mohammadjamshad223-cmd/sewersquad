import "server-only";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { safeEqual } from "../crypto";
import { logger } from "../logger";
import { AppError } from "../errors";
import { rateLimit } from "../auth/rate-limit";
import { companyTimeZone } from "../services/settings";
import { addDays, compareKeys, isDateKey, todayKey, type DateKey } from "@/lib/dates";

/**
 * Read-only REST API for AI agents (/api/v1/*). One key, from AGENT_API_KEY, sent as
 * "Authorization: Bearer <key>". GET only; 60 requests per minute. Money is in US dollars.
 */
export const RATE_LIMIT = 60;
const WINDOW_SECONDS = 60;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

function unauthorized() {
  return json({ error: "unauthorized", message: "Send the API key as: Authorization: Bearer <API_KEY>" }, 401, { "WWW-Authenticate": 'Bearer realm="sewersquad-api"' });
}

export const MIN_KEY_LENGTH = 32;

/** True only for an exact "Bearer <AGENT_API_KEY>" header. No key (or a too-short key) means no access. */
export function isAuthorized(header: string | null, key = env().AGENT_API_KEY) {
  if (!key || key.length < MIN_KEY_LENGTH || !header) return false;
  const m = /^Bearer ([^\s]+)$/.exec(header);
  return !!m && safeEqual(m[1]!, key);
}

const dateParam = z.string().refine(isDateKey, "Use YYYY-MM-DD.").optional();

export const querySchema = z
  .object({
    from: dateParam,
    to: dateParam,
    status: z.enum(["paid", "unpaid", "overdue"], { errorMap: () => ({ message: "Use paid, unpaid or overdue." }) }).optional(),
    customer_id: z.string().uuid("customer_id must be a customer id (UUID).").optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict()
  .superRefine((q, ctx) => {
    if (q.from && q.to && compareKeys(q.from, q.to) > 0) ctx.addIssue({ code: "custom", path: ["from"], message: "from must be on or before to." });
  });

export type ApiQuery = z.infer<typeof querySchema> & { today: DateKey; tz: string };
export type Page<T> = { data: T[]; total: number };

/** Instant boundaries [from 00:00, to+1 00:00) in the company time zone; Postgres does the DST math. */
export async function instantRange(tz: string, from?: string, to?: string) {
  if (!from && !to) return null;
  const at = async (key: string) => (await prisma.$queryRaw<{ a: Date }[]>`SELECT (${key}::date::timestamp AT TIME ZONE ${tz}) AS a`)[0]!.a;
  return { ...(from ? { gte: await at(from) } : {}), ...(to ? { lt: await at(addDays(to, 1)) } : {}) };
}

export const dollars = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : Math.round(cents) / 100);
/** Per-gallon prices are stored as fractional cents (e.g. 18.5 = $0.185). */
export const ratePerGallon = (cents: { toString(): string } | null | undefined) => (cents === null || cents === undefined ? null : Number(cents.toString()) / 100);
export const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

/** Wrap a list endpoint: auth → rate limit → validate query → JSON page. */
export function listEndpoint<T>(load: (q: ApiQuery) => Promise<Page<T>>) {
  return async (req: NextRequest) => {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    try {
      if (!isAuthorized(req.headers.get("authorization"))) {
        // Count failures per address so the key can't be guessed by brute force.
        await rateLimit(`api-v1-fail:${ip}`, RATE_LIMIT, WINDOW_SECONDS);
        return unauthorized();
      }
      const keyId = createHash("sha256").update(env().AGENT_API_KEY!).digest("hex").slice(0, 16);
      const remaining = await rateLimit(`api-v1:${keyId}`, RATE_LIMIT, WINDOW_SECONDS);
      const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
      if (!parsed.success) {
        return json({ error: "bad_request", message: "Invalid query parameters.", details: parsed.error.flatten().fieldErrors }, 400);
      }
      const tz = await companyTimeZone();
      const q = { ...parsed.data, tz, today: todayKey(tz) };
      const { data, total } = await load(q);
      return json(
        { data, page: q.page, limit: q.limit, total, has_more: q.page * q.limit < total },
        200,
        { "X-RateLimit-Limit": String(RATE_LIMIT), "X-RateLimit-Remaining": String(Math.max(0, remaining)) },
      );
    } catch (err) {
      if (err instanceof AppError && err.code === "RATE_LIMITED") return json({ error: "rate_limited", message: `Limit is ${RATE_LIMIT} requests per minute.` }, 429, { "Retry-After": String(WINDOW_SECONDS) });
      logger.error("api_v1.error", { err, path: req.nextUrl.pathname });
      return json({ error: "server_error", message: "Something went wrong." }, 500);
    }
  };
}

/** Anything but GET (and HEAD/OPTIONS handled by Next) is refused: this API never writes. */
export const methodNotAllowed = async () => json({ error: "method_not_allowed", message: "This API is read-only (GET only)." }, 405, { Allow: "GET" });
