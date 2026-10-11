import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/server/env";
import { safeEqual } from "@/server/crypto";
import { logger } from "@/server/logger";
import { materializeAllDuePlans } from "@/server/services/plans";
import { processDueDeliveries } from "@/server/services/notifications";
import { refreshOverdueInvoices, sendInvoiceReminders } from "@/server/services/invoices";
import { sendServiceReminders } from "@/server/services/reminders";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TASKS: Record<string, () => Promise<unknown>> = {
  // Generate upcoming recurring jobs inside the scheduling horizon (idempotent).
  "schedule-plans": materializeAllDuePlans,
  // Service reminders (14d / 7d / 24h by default) — deduplicated per job and offset.
  "service-reminders": sendServiceReminders,
  // Flag overdue invoices, then send due-date based reminders (skips paid / void).
  "invoice-reminders": async () => ({ overdue: await refreshOverdueInvoices(), reminders: await sendInvoiceReminders() }),
  // Retry pending email/SMS deliveries.
  "deliveries": () => processDueDeliveries(100),
  // Housekeeping: expired sessions, tokens, old rate-limit buckets.
  "cleanup": async () => ({
    sessions: (await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count,
    tokens: (await prisma.authToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } })).count,
    buckets: (await prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - 86_400_000) } } })).count,
  }),
};

/** Scheduled tasks (Vercel Cron or any scheduler). Requires `Authorization: Bearer $CRON_SECRET`. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ task: string }> }) {
  const secret = env().CRON_SECRET;
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { task } = await ctx.params;
  const fn = TASKS[task];
  if (!fn) return NextResponse.json({ error: "Unknown task" }, { status: 404 });
  const started = Date.now();
  try {
    const result = await fn();
    logger.info("cron.completed", { task, ms: Date.now() - started, result });
    return NextResponse.json({ ok: true, task, result });
  } catch (err) {
    logger.error("cron.failed", { task, err });
    return NextResponse.json({ ok: false, task }, { status: 500 });
  }
}
