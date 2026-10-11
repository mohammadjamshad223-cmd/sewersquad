import { NextResponse } from "next/server";
import { getActor } from "@/server/auth/session";
import { prisma } from "@/server/db";
import { customerScopeFor } from "@/server/authz/scope";
import { sha256Hex } from "@/server/crypto";
import { addDays, dateFromKey, todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";

export const dynamic = "force-dynamic";

/**
 * Change token for real-time refresh. Computed from the newest relevant updates for this user's
 * scope; the client re-renders when it changes. Cheap, indexed queries only.
 */
export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (actor.mfaEnrollmentRequired || (actor.mfaEnabled && !actor.mfaVerified)) return NextResponse.json({ error: "MFA required" }, { status: 403 });
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const window = { gte: dateFromKey(addDays(today, -2)), lte: dateFromKey(addDays(today, 14)) };
  const notif = prisma.notification.aggregate({ where: { userId: actor.userId }, _max: { createdAt: true }, _count: { readAt: true } });

  let parts: unknown[] = [];
  if (actor.kind === "DRIVER" && actor.driverId) {
    const [jobs, n] = await Promise.all([prisma.job.aggregate({ where: { driverId: actor.driverId, scheduledDate: window }, _max: { updatedAt: true }, _count: true }), notif]);
    parts = [jobs._max.updatedAt, jobs._count, n._max.createdAt];
  } else if (actor.kind === "CUSTOMER") {
    const scope = await customerScopeFor(actor);
    const [jobs, inv, er, n] = await Promise.all([
      prisma.job.aggregate({ where: { locationId: { in: scope.locationIds }, scheduledDate: window }, _max: { updatedAt: true } }),
      prisma.invoice.aggregate({ where: { organizationId: { in: scope.orgIds } }, _max: { updatedAt: true } }),
      prisma.emergencyRequest.aggregate({ where: { locationId: { in: scope.locationIds } }, _max: { updatedAt: true } }),
      notif,
    ]);
    parts = [jobs._max.updatedAt, inv._max.updatedAt, er._max.updatedAt, n._max.createdAt];
  } else {
    const [jobs, er, inv, n] = await Promise.all([
      prisma.job.aggregate({ where: { scheduledDate: window }, _max: { updatedAt: true }, _count: true }),
      prisma.emergencyRequest.aggregate({ _max: { updatedAt: true }, _count: true }),
      prisma.payment.aggregate({ _max: { updatedAt: true } }),
      notif,
    ]);
    parts = [jobs._max.updatedAt, jobs._count, er._max.updatedAt, er._count, inv._max.updatedAt, n._max.createdAt];
  }
  return NextResponse.json({ v: sha256Hex(JSON.stringify(parts)).slice(0, 16) }, { headers: { "Cache-Control": "no-store" } });
}
