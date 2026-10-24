import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { addDays, addMonths, dateFromKey, startOfMonthKey, todayKey, type DateKey } from "@/lib/dates";
import { agingBucket } from "@/domain/invoice-math";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { companyTimeZone } from "./settings";

const OPEN_INVOICE = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as const;
const REVENUE_INVOICE = ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"] as const;

/**
 * Instant boundaries for a local calendar range. Postgres does the time-zone math so DST is right.
 */
async function localRange(tz: string, from: DateKey, toExclusive: DateKey) {
  const rows = await prisma.$queryRaw<{ a: Date; b: Date }[]>`SELECT (${from}::date::timestamp AT TIME ZONE ${tz}) AS a, (${toExclusive}::date::timestamp AT TIME ZONE ${tz}) AS b`;
  return { from: rows[0]!.a, to: rows[0]!.b };
}

export async function adminKpis() {
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const mStart = startOfMonthKey(today);
  const nextM = addMonths(mStart, 1);
  const prevM = addMonths(mStart, -1);
  const month = await localRange(tz, mStart, nextM);
  const prev = await localRange(tz, prevM, mStart);
  const day = await localRange(tz, today, addDays(today, 1));

  const revenue = (from: DateKey, to: DateKey) =>
    prisma.invoice.aggregate({ where: { status: { in: [...REVENUE_INVOICE] }, issueDate: { gte: dateFromKey(from), lt: dateFromKey(to) } }, _sum: { subtotalCents: true, discountCents: true } });
  const collected = (r: { from: Date; to: Date }) => prisma.payment.aggregate({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, receivedAt: { gte: r.from, lt: r.to } }, _sum: { amountCents: true, refundedCents: true } });
  const gallons = (r: { from: Date; to: Date }) => prisma.serviceAssetRecord.aggregate({ where: { serviceRecord: { finishedAt: { gte: r.from, lt: r.to }, job: { status: { in: ["SUBMITTED", "COMPLETED"] } } } }, _sum: { gallonsPumped: true } });

  const [revM, revP, colM, colP, outstanding, overdue, activeCustomers, activeLocations, scheduledToday, completedToday, emergencies, galM, galP] = await Promise.all([
    revenue(mStart, nextM),
    revenue(prevM, mStart),
    collected(month),
    collected(prev),
    prisma.invoice.aggregate({ where: { status: { in: [...OPEN_INVOICE] } }, _sum: { balanceCents: true }, _count: true }),
    prisma.invoice.aggregate({ where: { status: { in: [...OPEN_INVOICE] }, dueDate: { lt: dateFromKey(today) } }, _sum: { balanceCents: true }, _count: true }),
    prisma.organization.count({ where: { status: "ACTIVE", deletedAt: null } }),
    prisma.serviceLocation.count({ where: { status: "ACTIVE", deletedAt: null, organization: { status: "ACTIVE" } } }),
    prisma.job.count({ where: { scheduledDate: dateFromKey(today), status: { notIn: ["CANCELLED"] } } }),
    prisma.job.count({ where: { completedAt: { gte: day.from, lt: day.to }, status: { in: ["SUBMITTED", "COMPLETED"] } } }),
    prisma.emergencyRequest.count({ where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    gallons(month),
    gallons(prev),
  ]);
  const net = (a: { _sum: { subtotalCents: number | null; discountCents: number | null } }) => (a._sum.subtotalCents ?? 0) - (a._sum.discountCents ?? 0);
  const coll = (a: { _sum: { amountCents: number | null; refundedCents: number | null } }) => (a._sum.amountCents ?? 0) - (a._sum.refundedCents ?? 0);
  return {
    today,
    revenueMonth: { value: net(revM), previous: net(revP) },
    collectedMonth: { value: coll(colM), previous: coll(colP) },
    outstanding: { value: outstanding._sum.balanceCents ?? 0, count: outstanding._count },
    overdue: { value: overdue._sum.balanceCents ?? 0, count: overdue._count },
    activeCustomers,
    activeLocations,
    scheduledToday,
    completedToday,
    emergencies,
    gallonsMonth: { value: galM._sum.gallonsPumped ?? 0, previous: galP._sum.gallonsPumped ?? 0 },
  };
}

export async function receivablesAging(organizationId?: string) {
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const open = await prisma.invoice.findMany({ where: { status: { in: [...OPEN_INVOICE] }, balanceCents: { gt: 0 }, ...(organizationId ? { organizationId } : {}) }, select: { dueDate: true, balanceCents: true } });
  const buckets = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };
  for (const i of open) buckets[agingBucket(i.dueDate.toISOString().slice(0, 10), today)] += i.balanceCents;
  return [
    { key: "current", label: "Current", cents: buckets.current },
    { key: "1_30", label: "1–30 days", cents: buckets["1_30"] },
    { key: "31_60", label: "31–60 days", cents: buckets["31_60"] },
    { key: "61_90", label: "61–90 days", cents: buckets["61_90"] },
    { key: "90_plus", label: "90+ days", cents: buckets["90_plus"] },
  ];
}

/** Monthly series for the last N months: revenue (by issue date), collections, gallons, jobs. */
export async function monthlySeries(months = 12) {
  const tz = await companyTimeZone();
  const start = addMonths(startOfMonthKey(todayKey(tz)), -(months - 1));
  const [rev, pay, gal] = await Promise.all([
    prisma.$queryRaw<{ m: string; cents: bigint }[]>`
      SELECT to_char(date_trunc('month', "issueDate"), 'YYYY-MM') AS m, SUM("subtotalCents" - "discountCents")::bigint AS cents
      FROM "Invoice" WHERE "status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND "issueDate" >= ${start}::date
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ m: string; cents: bigint }[]>`
      SELECT to_char(date_trunc('month', "receivedAt" AT TIME ZONE ${tz}), 'YYYY-MM') AS m, SUM("amountCents" - "refundedCents")::bigint AS cents
      FROM "Payment" WHERE "status" IN ('SUCCEEDED','PARTIALLY_REFUNDED','REFUNDED') AND "receivedAt" >= (${start}::date::timestamp AT TIME ZONE ${tz})
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ m: string; gallons: bigint; jobs: bigint }[]>`
      SELECT to_char(date_trunc('month', sr."finishedAt" AT TIME ZONE ${tz}), 'YYYY-MM') AS m, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons, COUNT(DISTINCT sr."jobId")::bigint AS jobs
      FROM "ServiceRecord" sr JOIN "Job" j ON j.id = sr."jobId" LEFT JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id
      WHERE j."status" IN ('SUBMITTED','COMPLETED') AND sr."finishedAt" >= (${start}::date::timestamp AT TIME ZONE ${tz})
      GROUP BY 1 ORDER BY 1`,
  ]);
  const keys: string[] = [];
  for (let i = 0; i < months; i++) keys.push(addMonths(start, i).slice(0, 7));
  const label = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
  return keys.map((k) => {
    const g = gal.find((x) => x.m === k);
    const jobs = Number(g?.jobs ?? 0);
    const gallons = Number(g?.gallons ?? 0);
    return {
      month: k,
      label: label(k),
      revenueCents: Number(rev.find((x) => x.m === k)?.cents ?? 0),
      collectedCents: Number(pay.find((x) => x.m === k)?.cents ?? 0),
      gallons,
      jobs,
      avgGallons: jobs ? Math.round(gallons / jobs) : 0,
    };
  });
}

export async function revenueBreakdowns(fromKey: DateKey, toKey: DateKey) {
  const from = dateFromKey(fromKey);
  const to = dateFromKey(addDays(toKey, 1));
  const [byService, byCustomer, byLocation, byDriver] = await Promise.all([
    prisma.$queryRaw<{ k: string; cents: bigint }[]>`
      SELECT j."serviceType"::text AS k, SUM(i."subtotalCents" - i."discountCents")::bigint AS cents
      FROM "Invoice" i JOIN "Job" j ON j.id = i."jobId"
      WHERE i."status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND i."issueDate" >= ${from} AND i."issueDate" < ${to}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<{ k: string; cents: bigint }[]>`
      SELECT o."name" AS k, SUM(i."subtotalCents" - i."discountCents")::bigint AS cents
      FROM "Invoice" i JOIN "Organization" o ON o.id = i."organizationId"
      WHERE i."status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND i."issueDate" >= ${from} AND i."issueDate" < ${to}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<{ k: string; cents: bigint }[]>`
      SELECT l."name" AS k, SUM(i."subtotalCents" - i."discountCents")::bigint AS cents
      FROM "Invoice" i JOIN "ServiceLocation" l ON l.id = i."serviceLocationId"
      WHERE i."status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND i."issueDate" >= ${from} AND i."issueDate" < ${to}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`,
    prisma.$queryRaw<{ k: string; cents: bigint }[]>`
      SELECT u."name" AS k, SUM(i."subtotalCents" - i."discountCents")::bigint AS cents
      FROM "Invoice" i JOIN "Job" j ON j.id = i."jobId" JOIN "Driver" d ON d.id = j."driverId" JOIN "User" u ON u.id = d."userId"
      WHERE i."status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND i."issueDate" >= ${from} AND i."issueDate" < ${to}
      GROUP BY 1 ORDER BY 2 DESC`,
  ]);
  const map = (rows: { k: string; cents: bigint }[], labeler?: (k: string) => string) => rows.map((r) => ({ name: labeler ? labeler(r.k) : r.k, cents: Number(r.cents) }));
  return { byService: map(byService, (k) => SERVICE_TYPE_LABEL[k] ?? k), byCustomer: map(byCustomer), byLocation: map(byLocation), byDriver: map(byDriver) };
}

export async function operationsMetrics(fromKey: DateKey, toKey: DateKey) {
  const tz = await companyTimeZone();
  const r = await localRange(tz, fromKey, addDays(toKey, 1));
  const [perDay, perDriver, scheduledInRange, completedInRange, missed, emergency] = await Promise.all([
    prisma.$queryRaw<{ d: string; jobs: bigint; gallons: bigint }[]>`
      SELECT to_char(sr."finishedAt" AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS d, COUNT(DISTINCT sr."jobId")::bigint AS jobs, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons
      FROM "ServiceRecord" sr JOIN "Job" j ON j.id = sr."jobId" LEFT JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id
      WHERE j."status" IN ('SUBMITTED','COMPLETED') AND sr."finishedAt" >= ${r.from} AND sr."finishedAt" < ${r.to}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ name: string; jobs: bigint; gallons: bigint }[]>`
      SELECT u."name" AS name, COUNT(DISTINCT sr."jobId")::bigint AS jobs, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons
      FROM "ServiceRecord" sr JOIN "Job" j ON j.id = sr."jobId" JOIN "Driver" d ON d.id = sr."driverId" JOIN "User" u ON u.id = d."userId"
      LEFT JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id
      WHERE j."status" IN ('SUBMITTED','COMPLETED') AND sr."finishedAt" >= ${r.from} AND sr."finishedAt" < ${r.to}
      GROUP BY 1 ORDER BY 2 DESC`,
    prisma.job.count({ where: { scheduledDate: { gte: dateFromKey(fromKey), lte: dateFromKey(toKey) }, status: { not: "CANCELLED" } } }),
    prisma.job.count({ where: { scheduledDate: { gte: dateFromKey(fromKey), lte: dateFromKey(toKey) }, status: { in: ["SUBMITTED", "COMPLETED"] } } }),
    prisma.job.count({ where: { scheduledDate: { gte: dateFromKey(fromKey), lte: dateFromKey(toKey) }, status: { in: ["MISSED", "UNABLE_TO_SERVICE"] } } }),
    prisma.$queryRaw<{ requests: bigint; ack_min: number | null; dispatch_min: number | null; completed: bigint }[]>`
      SELECT COUNT(*)::bigint AS requests,
        AVG(EXTRACT(EPOCH FROM (e."acknowledgedAt" - e."createdAt")) / 60)::float AS ack_min,
        AVG(EXTRACT(EPOCH FROM (j."createdAt" - e."createdAt")) / 60)::float AS dispatch_min,
        COUNT(*) FILTER (WHERE e."status" = 'COMPLETED')::bigint AS completed
      FROM "EmergencyRequest" e LEFT JOIN "Job" j ON j.id = e."jobId"
      WHERE e."createdAt" >= ${r.from} AND e."createdAt" < ${r.to}`,
  ]);
  return {
    perDay: perDay.map((p) => ({ date: p.d, jobs: Number(p.jobs), gallons: Number(p.gallons) })),
    perDriver: perDriver.map((p) => ({ name: p.name, jobs: Number(p.jobs), gallons: Number(p.gallons) })),
    scheduled: scheduledInRange,
    completed: completedInRange,
    missed,
    completionRate: scheduledInRange ? completedInRange / scheduledInRange : null,
    emergency: { requests: Number(emergency[0]?.requests ?? 0), avgAckMinutes: emergency[0]?.ack_min ?? null, avgDispatchMinutes: emergency[0]?.dispatch_min ?? null, completed: Number(emergency[0]?.completed ?? 0) },
  };
}

export async function attentionItems() {
  const tz = await companyTimeZone();
  const today = dateFromKey(todayKey(tz));
  const week = dateFromKey(addDays(todayKey(tz), 7));
  const [overdueInvoices, emergencies, unassigned, awaitingApproval, missingManifests, failedPayments, overdueServices, issues, pendingCharges] = await Promise.all([
    prisma.invoice.count({ where: { status: "OVERDUE" } }),
    prisma.emergencyRequest.count({ where: { status: { in: ["SUBMITTED", "ACKNOWLEDGED", "CONTACTING_CUSTOMER", "AWAITING_APPROVAL"] } } }),
    prisma.job.count({ where: { status: "SCHEDULED", driverId: null, scheduledDate: { lte: week } } }),
    prisma.job.count({ where: { status: "SUBMITTED" } }),
    prisma.job.count({ where: { status: "COMPLETED", OR: [{ manifest: null }, { manifest: { status: { not: "FINALIZED" } } }] } }),
    prisma.payment.count({ where: { status: "FAILED", updatedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
    prisma.job.count({ where: { scheduledDate: { lt: today }, status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED"] } } }),
    prisma.issueReport.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.jobCharge.count({ where: { status: "PENDING_APPROVAL" } }),
  ]);
  return [
    { key: "emergencies", label: "Open emergency requests", count: emergencies, href: "/admin/emergencies", tone: "danger" as const },
    { key: "approval", label: "Jobs awaiting approval", count: awaitingApproval, href: "/admin/jobs?status=SUBMITTED", tone: "warning" as const },
    { key: "unassigned", label: "Unassigned jobs (next 7 days)", count: unassigned, href: "/admin/dispatch", tone: "warning" as const },
    { key: "overdueServices", label: "Overdue services", count: overdueServices, href: "/admin/jobs?status=OVERDUE", tone: "danger" as const },
    { key: "overdueInvoices", label: "Overdue invoices", count: overdueInvoices, href: "/admin/invoices?status=OVERDUE", tone: "danger" as const },
    { key: "failedPayments", label: "Failed payments (30 days)", count: failedPayments, href: "/admin/payments?status=FAILED", tone: "danger" as const },
    { key: "missingManifests", label: "Completed jobs without a finalized manifest", count: missingManifests, href: "/admin/manifests?status=PENDING_REVIEW", tone: "warning" as const },
    { key: "issues", label: "Open driver-reported issues", count: issues, href: "/admin/drivers?tab=issues", tone: "warning" as const },
    { key: "charges", label: "Additional charges to review", count: pendingCharges, href: "/admin/jobs?status=SUBMITTED", tone: "warning" as const },
  ];
}

/** Contribution by job for a date range. Costs that are not recorded are reported as missing. */
export async function serviceContribution(fromKey: DateKey, toKey: DateKey) {
  const { computeContribution, allocateCostByGallons } = await import("@/domain/profitability");
  const jobs = await prisma.job.findMany({
    where: { status: "COMPLETED", scheduledDate: { gte: dateFromKey(fromKey), lte: dateFromKey(toKey) } },
    include: {
      invoices: { where: { status: { notIn: ["DRAFT", "VOID"] } } },
      organization: { select: { name: true } },
      location: { select: { name: true } },
      driver: { select: { hourlyCostCents: true } },
      vehicle: { select: { costPerHourCents: true } },
      serviceRecord: { select: { arrivedAt: true, startedAt: true, finishedAt: true, assetRecords: { select: { gallonsPumped: true } } } },
      loadAllocations: { include: { disposalEvent: { include: { allocations: true } } } },
    },
    orderBy: { scheduledDate: "desc" },
    take: 500,
  });
  return jobs.map((j) => {
    const revenue = j.invoices.reduce((s, i) => s + i.subtotalCents - i.discountCents, 0);
    let disposal: number | null = null;
    if (j.loadAllocations.length) {
      disposal = 0;
      for (const a of j.loadAllocations) {
        const shares = allocateCostByGallons(a.disposalEvent.totalCostCents, a.disposalEvent.allocations.map((x) => ({ id: x.jobId, gallons: x.gallons })));
        disposal += shares.get(j.id) ?? 0;
      }
    }
    const rec = j.serviceRecord;
    const hours = rec?.finishedAt && (rec.arrivedAt ?? rec.startedAt) ? (rec.finishedAt.getTime() - (rec.arrivedAt ?? rec.startedAt)!.getTime()) / 3_600_000 : null;
    const labor = hours !== null && j.driver?.hourlyCostCents ? Math.round(hours * j.driver.hourlyCostCents) : null;
    const truck = hours !== null && j.vehicle?.costPerHourCents ? Math.round(hours * j.vehicle.costPerHourCents) : null;
    const c = computeContribution({ revenueCents: revenue, disposalCostCents: disposal, laborCostCents: labor, truckCostCents: truck });
    return { jobId: j.id, jobNumber: j.jobNumber, date: j.scheduledDate, customer: j.organization.name, location: j.location.name, gallons: rec?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0, invoiced: j.invoices.length > 0, ...c };
  });
}

export function bigintSafe<T>(rows: T[]): T[] {
  return JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? Number(v) : v instanceof Prisma.Decimal ? v.toString() : v)));
}

/**
 * Gross profit by month: invoiced revenue minus estimated disposal cost, where disposal cost is
 * the gallons invoiced that month × the average cost per gallon across all disposal-site bills.
 * Gallons come from the job's service record, or the per-gallon lines of invoices without a job.
 */
export async function grossProfitByMonth(months = 6) {
  const tz = await companyTimeZone();
  const start = addMonths(startOfMonthKey(todayKey(tz)), -(months - 1));
  const [rows, cost, external] = await Promise.all([
    prisma.$queryRaw<{ m: string; rev: bigint; gal: Prisma.Decimal | null; invoices: bigint }[]>`
      WITH inv AS (
        SELECT i.id, i."jobId", to_char(date_trunc('month', i."issueDate"), 'YYYY-MM') AS m, (i."subtotalCents" - i."discountCents") AS rev
        FROM "Invoice" i
        WHERE i."status" IN ('SENT','VIEWED','PARTIALLY_PAID','PAID','OVERDUE') AND i."issueDate" >= ${start}::date
      )
      SELECT inv.m, SUM(inv.rev)::bigint AS rev, COUNT(*)::bigint AS invoices,
        SUM(COALESCE(
          (SELECT SUM(sar."gallonsPumped") FROM "ServiceRecord" sr JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id WHERE sr."jobId" = inv."jobId"),
          (SELECT SUM(li."quantity") FROM "InvoiceLineItem" li WHERE li."invoiceId" = inv.id AND li."kind" = 'PER_GALLON'),
          0)) AS gal
      FROM inv GROUP BY inv.m ORDER BY inv.m`,
    prisma.$queryRaw<{ cents: bigint | null; gal: bigint | null }[]>`
      SELECT SUM(l."amountCents")::bigint AS cents, SUM(l."gallons")::bigint AS gal
      FROM "DisposalBillLine" l JOIN "DisposalBill" b ON b.id = l."billId"
      WHERE b."status" <> 'VOID' AND l."gallons" IS NOT NULL AND l."gallons" > 0`,
    prisma.$queryRaw<{ m: string; cents: bigint }[]>`
      SELECT to_char(date_trunc('month', "date"), 'YYYY-MM') AS m, SUM("amountCents")::bigint AS cents
      FROM "Expense" WHERE "deletedAt" IS NULL AND "date" >= ${start}::date GROUP BY 1`,
  ]);
  const costGal = Number(cost[0]?.gal ?? 0);
  const centsPerGallon = costGal > 0 ? Number(cost[0]!.cents ?? 0) / costGal : null;
  const keys: string[] = [];
  for (let i = 0; i < months; i++) keys.push(addMonths(start, i).slice(0, 7));
  const label = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const out = keys.map((k) => {
    const r = rows.find((x) => x.m === k);
    const revenueCents = Number(r?.rev ?? 0);
    const gallons = Math.round(Number(r?.gal ?? 0));
    const disposalCents = centsPerGallon !== null ? Math.round(gallons * centsPerGallon) : 0;
    const grossCents = revenueCents - disposalCents;
    // External costs (gas, contractors, tools, permits…) recorded on the External costs page.
    const otherCostsCents = Number(external.find((x) => x.m === k)?.cents ?? 0);
    const profitCents = grossCents - otherCostsCents;
    return { month: k, label: label(k), invoices: Number(r?.invoices ?? 0), revenueCents, gallons, disposalCents, grossCents, otherCostsCents, profitCents, marginPct: revenueCents > 0 ? (profitCents / revenueCents) * 100 : null };
  });
  return { centsPerGallon, months: out.reverse() };
}
