import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { notFound } from "../errors";
import { invoiceScopedWhere, paymentScopedWhere, type CustomerScope } from "../authz/scope";
import { addDays, dateFromKey, isDateKey, todayKey } from "@/lib/dates";
import { companyTimeZone } from "./settings";

const UPCOMING = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "MISSED", "UNABLE_TO_SERVICE"] as const;
const DONE = ["SUBMITTED", "COMPLETED"] as const;
const OPEN_INV = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as const;

export const customerJobSelect = {
  id: true,
  jobNumber: true,
  status: true,
  type: true,
  serviceType: true,
  scheduledDate: true,
  occurrenceDate: true,
  windowStart: true,
  windowEnd: true,
  confirmedByOffice: true,
  completedAt: true,
  location: { select: { id: true, name: true, city: true } },
  assets: { select: { asset: { select: { assetTag: true, type: true, capacityGallons: true, customTypeLabel: true } } } },
  driver: { select: { user: { select: { name: true } } } },
} satisfies Prisma.JobSelect;

export function isRescheduled(j: { scheduledDate: Date; occurrenceDate: Date | null }) {
  return Boolean(j.occurrenceDate && j.occurrenceDate.getTime() !== j.scheduledDate.getTime());
}

export async function customerDashboard(scope: CustomerScope, locationIds: string[], selected: string | null) {
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const yearAgo = dateFromKey(addDays(today, -365));
  const invWhere = invoiceScopedWhere(scope, selected);
  const [upcoming, lastDone, completedCount, gallons, openInvoices, rep, emergencies] = await Promise.all([
    prisma.job.findMany({ where: { locationId: { in: locationIds }, status: { in: [...UPCOMING] } }, select: customerJobSelect, orderBy: [{ scheduledDate: "asc" }, { windowStart: "asc" }], take: 8 }),
    prisma.job.findFirst({
      where: { locationId: { in: locationIds }, status: { in: [...DONE] } },
      orderBy: { completedAt: "desc" },
      select: { ...customerJobSelect, serviceRecord: { select: { assetRecords: { select: { gallonsPumped: true } } } }, manifest: { select: { id: true, manifestNumber: true, status: true, documents: { where: { type: "MANIFEST", visibility: "CUSTOMER", deletedAt: null }, select: { id: true }, take: 1 } } }, invoices: { where: { status: { not: "DRAFT" } }, select: { id: true, invoiceNumber: true } } },
    }),
    prisma.job.count({ where: { locationId: { in: locationIds }, status: { in: [...DONE] }, scheduledDate: { gte: yearAgo } } }),
    prisma.serviceAssetRecord.aggregate({ where: { serviceRecord: { job: { locationId: { in: locationIds }, status: { in: [...DONE] }, scheduledDate: { gte: yearAgo } } } }, _sum: { gallonsPumped: true } }),
    prisma.invoice.aggregate({ where: { AND: [invWhere, { status: { in: [...OPEN_INV] } }] }, _sum: { balanceCents: true }, _count: true }),
    prisma.organization.findFirst({ where: { id: { in: scope.orgIds } }, select: { accountRep: { select: { name: true, email: true, phone: true } } } }),
    prisma.emergencyRequest.findMany({ where: { locationId: { in: locationIds }, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "desc" }, take: 3, include: { location: { select: { name: true } } } }),
  ]);
  return {
    today,
    upcoming,
    next: upcoming.find((j) => j.status !== "MISSED" && j.status !== "UNABLE_TO_SERVICE") ?? upcoming[0] ?? null,
    lastDone,
    lastGallons: lastDone?.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? null,
    completedCount,
    gallons12m: gallons._sum.gallonsPumped ?? 0,
    balanceCents: openInvoices._sum.balanceCents ?? 0,
    openInvoiceCount: openInvoices._count,
    rep: rep?.accountRep ?? null,
    emergencies,
  };
}

export async function customerUpcoming(locationIds: string[], page: number, pageSize = 25) {
  const where: Prisma.JobWhereInput = { locationId: { in: locationIds }, status: { in: [...UPCOMING] } };
  const [items, total] = await Promise.all([
    prisma.job.findMany({ where, select: customerJobSelect, orderBy: [{ scheduledDate: "asc" }, { windowStart: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
    prisma.job.count({ where }),
  ]);
  return { items, total, pageSize };
}

export async function customerHistory(locationIds: string[], params: { page: number; from?: string; to?: string; q?: string }, pageSize = 25) {
  const where: Prisma.JobWhereInput = {
    locationId: { in: locationIds },
    status: { in: [...DONE, "CANCELLED"] },
    ...(params.from || params.to ? { scheduledDate: { ...(params.from && isDateKey(params.from) ? { gte: dateFromKey(params.from) } : {}), ...(params.to && isDateKey(params.to) ? { lte: dateFromKey(params.to) } : {}) } } : {}),
    ...(params.q ? { OR: [{ jobNumber: { contains: params.q, mode: "insensitive" } }, { manifest: { manifestNumber: { contains: params.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.job.findMany({
      where,
      select: {
        ...customerJobSelect,
        serviceRecord: { select: { assetRecords: { select: { gallonsPumped: true } } } },
        manifest: { select: { id: true, manifestNumber: true, status: true, documents: { where: { type: "MANIFEST", visibility: "CUSTOMER", deletedAt: null }, select: { id: true }, take: 1 } } },
        invoices: { where: { status: { not: "DRAFT" } }, select: { id: true, invoiceNumber: true, status: true } },
      },
      orderBy: { scheduledDate: "desc" },
      skip: (params.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.job.count({ where }),
  ]);
  return { items, total, pageSize };
}

/** One job visible to the customer. Internal notes and office-only fields are never selected. */
export async function customerJob(locationIds: string[], jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, locationId: { in: locationIds } },
    select: {
      ...customerJobSelect,
      instructions: true,
      location: { select: { id: true, name: true, city: true, addressLine1: true, state: true, postalCode: true, organizationId: true } },
      statusEvents: { orderBy: { occurredAt: "asc" }, select: { toStatus: true, occurredAt: true } },
      serviceRecord: { select: { arrivedAt: true, finishedAt: true, conditionAfter: true, followUpRecommendations: true, assetRecords: { select: { gallonsPumped: true, servicePerformed: true, asset: { select: { assetTag: true, type: true, capacityGallons: true, customTypeLabel: true } } } } } },
      manifest: { select: { id: true, manifestNumber: true, status: true, documents: { where: { visibility: "CUSTOMER", deletedAt: null }, select: { id: true, title: true, type: true } } } },
      invoices: { where: { status: { not: "DRAFT" } }, select: { id: true, invoiceNumber: true, status: true, totalCents: true, balanceCents: true } },
      documents: { where: { visibility: "CUSTOMER", deletedAt: null, type: { in: ["SERVICE_PHOTO", "OTHER"] } }, select: { id: true, title: true, photoPhase: true, type: true } },
      emergencyRequest: { select: { id: true, requestNumber: true } },
    },
  });
  if (!job) throw notFound();
  return job;
}

export async function customerInvoices(scope: CustomerScope, selected: string | null, params: { page: number; status?: string; from?: string; to?: string; q?: string }, pageSize = 25) {
  const where: Prisma.InvoiceWhereInput = {
    AND: [
      invoiceScopedWhere(scope, selected),
      params.status === "OPEN" ? { status: { in: [...OPEN_INV] } } : params.status ? { status: params.status as never } : {},
      params.from && isDateKey(params.from) ? { issueDate: { gte: dateFromKey(params.from) } } : {},
      params.to && isDateKey(params.to) ? { issueDate: { lte: dateFromKey(params.to) } } : {},
      params.q ? { invoiceNumber: { contains: params.q, mode: "insensitive" } } : {},
    ],
  };
  const [items, total, open] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: { serviceLocation: { select: { name: true } }, lineItems: { take: 1, orderBy: { sortOrder: "asc" }, select: { description: true } }, documents: { where: { type: "INVOICE", visibility: "CUSTOMER", deletedAt: null }, select: { id: true }, take: 1 } },
      orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
      skip: (params.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { AND: [invoiceScopedWhere(scope, selected), { status: { in: [...OPEN_INV] } }] }, _sum: { balanceCents: true }, _count: true }),
  ]);
  return { items, total, pageSize, openBalance: open._sum.balanceCents ?? 0, openCount: open._count };
}

export async function customerInvoice(scope: CustomerScope, invoiceId: string) {
  const inv = await prisma.invoice.findFirst({
    where: { AND: [{ id: invoiceId }, invoiceScopedWhere(scope)] },
    include: {
      lineItems: { orderBy: { sortOrder: "asc" } },
      serviceLocation: true,
      organization: { select: { id: true, name: true, accountNumber: true } },
      billingProfile: true,
      job: { select: { id: true, jobNumber: true } },
      manifest: { select: { id: true, manifestNumber: true, status: true } },
      documents: { where: { visibility: "CUSTOMER", deletedAt: null, type: { in: ["INVOICE", "RECEIPT"] } }, select: { id: true, title: true, type: true } },
      allocations: { where: { payment: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED", "PROCESSING"] } } }, include: { payment: { select: { id: true, paymentNumber: true, method: true, status: true, receivedAt: true, createdAt: true } } } },
    },
  });
  if (!inv) throw notFound();
  return inv;
}

export async function customerPayments(scope: CustomerScope, selected: string | null, page: number, pageSize = 25) {
  const where = paymentScopedWhere(scope, selected);
  const [items, total] = await Promise.all([
    prisma.payment.findMany({
      where: { AND: [where, { status: { notIn: ["PENDING", "CANCELLED"] } }] },
      include: { allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.payment.count({ where: { AND: [where, { status: { notIn: ["PENDING", "CANCELLED"] } }] } }),
  ]);
  const receipts = await prisma.document.findMany({ where: { type: "RECEIPT", visibility: "CUSTOMER", deletedAt: null, paymentId: { in: items.map((p) => p.id) } }, select: { id: true, paymentId: true } });
  return { items: items.map((p) => ({ ...p, receiptId: receipts.find((r) => r.paymentId === p.id)?.id ?? null })), total, pageSize };
}

export async function customerManifests(locationIds: string[], params: { page: number; q?: string; from?: string; to?: string; wasteType?: string }, pageSize = 25) {
  const where: Prisma.ManifestWhereInput = {
    locationId: { in: locationIds },
    status: "FINALIZED",
    ...(params.wasteType ? { wasteType: params.wasteType } : {}),
    ...(params.from || params.to ? { serviceDate: { ...(params.from && isDateKey(params.from) ? { gte: dateFromKey(params.from) } : {}), ...(params.to && isDateKey(params.to) ? { lte: dateFromKey(params.to) } : {}) } } : {}),
    ...(params.q ? { OR: [{ manifestNumber: { contains: params.q, mode: "insensitive" } }, { job: { jobNumber: { contains: params.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.manifest.findMany({
      where,
      include: { location: { select: { name: true, city: true } }, job: { select: { id: true, jobNumber: true } }, documents: { where: { visibility: "CUSTOMER", deletedAt: null, type: { in: ["MANIFEST", "MANIFEST_OFFICIAL"] } }, select: { id: true, type: true } } },
      orderBy: { serviceDate: "desc" },
      skip: (params.page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.manifest.count({ where }),
  ]);
  return { items, total, pageSize };
}

export async function customerLocations(scope: CustomerScope) {
  return prisma.serviceLocation.findMany({
    where: { id: { in: scope.locationIds } },
    include: {
      assets: { where: { deletedAt: null }, orderBy: { assetTag: "asc" } },
      plans: { where: { status: "ACTIVE" }, include: { recurrenceRule: true } },
      _count: { select: { jobs: { where: { status: { in: [...DONE] } } } } },
    },
    orderBy: { name: "asc" },
  });
}

export async function customerLocation(scope: CustomerScope, locationId: string) {
  if (!scope.locationIds.includes(locationId)) throw notFound();
  const loc = await prisma.serviceLocation.findUniqueOrThrow({
    where: { id: locationId },
    include: {
      organization: { select: { name: true } },
      assets: { where: { deletedAt: null }, orderBy: { assetTag: "asc" } },
      plans: { where: { status: { in: ["ACTIVE", "PAUSED"] } }, include: { recurrenceRule: true } },
      contacts: true,
    },
  });
  const volumes = await prisma.$queryRaw<{ m: string; gallons: bigint }[]>`
    SELECT to_char(date_trunc('month', j."scheduledDate"), 'YYYY-MM') AS m, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons
    FROM "Job" j JOIN "ServiceRecord" sr ON sr."jobId" = j.id JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id
    WHERE j."locationId" = ${locationId}::uuid AND j."status" IN ('SUBMITTED','COMPLETED') AND j."scheduledDate" >= (CURRENT_DATE - INTERVAL '24 months')
    GROUP BY 1 ORDER BY 1`;
  return { loc, volumes: volumes.map((v) => ({ month: v.m, gallons: Number(v.gallons) })) };
}

/** Pumping volumes per location for consolidated reporting. */
export async function volumesByLocation(locationIds: string[], fromKey: string) {
  const rows = await prisma.$queryRaw<{ id: string; name: string; jobs: bigint; gallons: bigint }[]>`
    SELECT l.id, l."name", COUNT(DISTINCT j.id)::bigint AS jobs, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons
    FROM "ServiceLocation" l
    LEFT JOIN "Job" j ON j."locationId" = l.id AND j."status" IN ('SUBMITTED','COMPLETED') AND j."scheduledDate" >= ${fromKey}::date
    LEFT JOIN "ServiceRecord" sr ON sr."jobId" = j.id
    LEFT JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id
    WHERE l.id = ANY(${locationIds}::uuid[])
    GROUP BY l.id, l."name" ORDER BY l."name"`;
  return rows.map((r) => ({ id: r.id, name: r.name, jobs: Number(r.jobs), gallons: Number(r.gallons) }));
}
