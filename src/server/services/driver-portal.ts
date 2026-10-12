import "server-only";
import { prisma } from "../db";
import { notFound } from "../errors";
import { addDays, dateFromKey, todayKey } from "@/lib/dates";
import { planCapacity } from "@/domain/capacity";
import { companyTimeZone } from "./settings";

const ROUTE_STATUSES = ["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "SUBMITTED", "COMPLETED", "UNABLE_TO_SERVICE"] as const;

const stopInclude = {
  location: { select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, siteContactName: true, siteContactPhone: true, accessInstructions: true, specialRequirements: true, latitude: true, longitude: true, manifestFee: true } },
  organization: { select: { name: true, primaryPhone: true } },
  assets: { include: { asset: { select: { id: true, assetTag: true, type: true, capacityGallons: true, installLocation: true, customTypeLabel: true } } } },
  vehicle: { select: { unitNumber: true, tankCapacityGallons: true } },
} as const;

/** Today's route for one driver, in dispatch order, with an estimated load check. */
export async function driverDay(driverId: string, dayKey?: string) {
  const tz = await companyTimeZone();
  const day = dayKey ?? todayKey(tz);
  const [driver, stops] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: driverId }, include: { user: { select: { name: true } }, defaultVehicle: true } }),
    prisma.job.findMany({ where: { driverId, scheduledDate: dateFromKey(day), status: { in: [...ROUTE_STATUSES] } }, include: stopInclude, orderBy: [{ routeOrder: { sort: "asc", nulls: "last" } }, { windowStart: "asc" }] }),
  ]);
  const remaining = stops.filter((s) => !["SUBMITTED", "COMPLETED", "UNABLE_TO_SERVICE"].includes(s.status));
  const truck = stops.find((s) => s.vehicle)?.vehicle ?? (driver.defaultVehicle ? { unitNumber: driver.defaultVehicle.unitNumber, tankCapacityGallons: driver.defaultVehicle.tankCapacityGallons } : null);
  const capacity = truck ? planCapacity(truck.tankCapacityGallons, stops.map((s) => ({ kind: "service" as const, id: s.id, label: s.location.name, estimatedGallons: s.estimatedGallons }))) : null;
  return {
    day,
    driver,
    truck,
    stops,
    current: stops.find((s) => ["EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"].includes(s.status)) ?? remaining[0] ?? null,
    stats: {
      total: stops.length,
      completed: stops.filter((s) => s.status === "SUBMITTED" || s.status === "COMPLETED").length,
      remaining: remaining.length,
      estimatedGallons: stops.reduce((sum, s) => sum + (s.estimatedGallons ?? 0), 0),
    },
    capacity,
  };
}

export async function driverUpcoming(driverId: string, days = 14) {
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  return prisma.job.findMany({
    where: { driverId, scheduledDate: { gte: dateFromKey(today), lte: dateFromKey(addDays(today, days)) }, status: { in: ["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"] } },
    include: stopInclude,
    orderBy: [{ scheduledDate: "asc" }, { routeOrder: { sort: "asc", nulls: "last" } }, { windowStart: "asc" }],
  });
}

/** A job the driver is assigned to, with what they need on site. No billing or internal notes. */
export async function driverJob(driverId: string, jobId: string) {
  const job = await prisma.job.findFirst({
    where: { id: jobId, driverId },
    include: {
      ...stopInclude,
      plan: { select: { specialInstructions: true } },
      serviceRecord: { include: { assetRecords: true } },
      documents: { where: { deletedAt: null, type: { in: ["SERVICE_PHOTO", "MANIFEST_OFFICIAL"] } }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, photoPhase: true, title: true, assetId: true } },
      charges: { orderBy: { createdAt: "asc" } },
      manifest: { select: { manifestNumber: true, status: true, rejectionReason: true } },
      statusEvents: { orderBy: { occurredAt: "asc" }, select: { toStatus: true, occurredAt: true, note: true } },
    },
  });
  if (!job) throw notFound();
  // Prior service history for the equipment on this job (authorized historical records).
  const history = await prisma.serviceAssetRecord.findMany({
    where: { assetId: { in: job.assets.map((a) => a.assetId) }, serviceRecord: { jobId: { not: jobId }, job: { status: { in: ["SUBMITTED", "COMPLETED"] } } } },
    include: { asset: { select: { assetTag: true } }, serviceRecord: { select: { finishedAt: true, conditionAfter: true, notes: true } } },
    orderBy: { serviceRecord: { finishedAt: "desc" } },
    take: 6,
  });
  const otherAssets = await prisma.serviceAsset.findMany({ where: { locationId: job.locationId, status: "ACTIVE", deletedAt: null, id: { notIn: job.assets.map((a) => a.assetId) } }, select: { id: true, assetTag: true, type: true, capacityGallons: true, installLocation: true, customTypeLabel: true } });
  return { job, history, otherAssets };
}

export async function driverHistory(driverId: string, page: number, pageSize = 25) {
  const where = { driverId, status: { in: ["SUBMITTED", "COMPLETED", "UNABLE_TO_SERVICE"] as ("SUBMITTED" | "COMPLETED" | "UNABLE_TO_SERVICE")[] } };
  const [items, total] = await Promise.all([
    prisma.job.findMany({ where, include: { location: { select: { name: true, city: true } }, serviceRecord: { include: { assetRecords: { select: { gallonsPumped: true } } } }, manifest: { select: { manifestNumber: true, status: true } } }, orderBy: { scheduledDate: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.job.count({ where }),
  ]);
  return { items, total, pageSize };
}
