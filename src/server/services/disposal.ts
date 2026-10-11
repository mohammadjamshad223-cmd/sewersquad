import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { hasPermission } from "../authz/guards";
import { lineAmountCents } from "@/domain/invoice-math";
import { reconcile, reconcileEvent } from "@/domain/reconciliation";
import { dateFromKey, isDateKey } from "@/lib/dates";
import { parseDollarRateToCentsString } from "@/lib/money";
import { storeDocument } from "./documents";

export const disposalSchema = z.object({
  vehicleId: z.string().uuid("Select a truck."),
  driverId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  facilityId: z.string().uuid("Select a disposal facility."),
  disposedAt: z.string().min(1, "Enter the disposal date and time."),
  wasteType: z.string().trim().min(2).max(120),
  gallons: z.coerce.number().int("Whole gallons only.").min(0).max(20_000),
  ratePerGallon: z.string().optional(),
  ticketNumber: z.string().trim().max(80).optional(),
  openingLoadGallons: z.coerce.number().int().min(0).max(20_000).optional().nullable(),
  closingLoadGallons: z.coerce.number().int().min(0).max(20_000).optional().nullable(),
  adjustmentGallons: z.coerce.number().int().min(-20_000).max(20_000).optional().default(0),
  adjustmentReason: z.string().trim().max(500).optional(),
  facilityAcknowledged: z.coerce.boolean().optional().default(false),
  notes: z.string().trim().max(2000).optional(),
  jobIds: z.array(z.string().uuid()).default([]),
});

/** Jobs on this truck with collected gallons that are not yet allocated to a disposal event. */
export async function unallocatedLoads(vehicleId: string, driverId?: string) {
  const jobs = await prisma.job.findMany({
    where: {
      vehicleId,
      ...(driverId ? { driverId } : {}),
      status: { in: ["SUBMITTED", "COMPLETED"] },
      loadAllocations: { none: {} },
      completedAt: { gte: new Date(Date.now() - 14 * 86_400_000) },
    },
    include: { location: { select: { name: true } }, serviceRecord: { include: { assetRecords: true } } },
    orderBy: { completedAt: "asc" },
  });
  return jobs.map((j) => ({ id: j.id, jobNumber: j.jobNumber, location: j.location.name, completedAt: j.completedAt, gallons: j.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0 }));
}

export async function recordDisposal(actor: Actor, input: z.infer<typeof disposalSchema>, ticket: { bytes: Uint8Array; name: string } | null) {
  const isDriver = actor.kind === "DRIVER" && actor.driverId;
  if (!isDriver && !hasPermission(actor, "disposal.write")) throw forbidden();
  const driverId = isDriver ? actor.driverId! : input.driverId;
  if (!driverId) throw badRequest("Select the driver.");
  if (input.adjustmentGallons !== 0 && (!input.adjustmentReason || input.adjustmentReason.length < 3)) throw badRequest("Explain the load adjustment.");
  const disposedAt = new Date(input.disposedAt);
  if (Number.isNaN(disposedAt.getTime())) throw badRequest("Invalid disposal time.");
  if (disposedAt.getTime() > Date.now() + 10 * 60_000) throw badRequest("Disposal time cannot be in the future.");

  const facility = await prisma.disposalFacility.findUnique({ where: { id: input.facilityId } });
  if (!facility || facility.status !== "ACTIVE") throw badRequest("Facility not available.");
  const rate = input.ratePerGallon ? parseDollarRateToCentsString(input.ratePerGallon) : facility.ratePerGallonCents?.toString() ?? null;
  if (rate === null) throw badRequest("Enter the disposal rate per gallon (no default rate is configured for this facility).");

  // Allocations: only jobs on this truck that are not yet allocated.
  const loads = await prisma.job.findMany({
    where: { id: { in: input.jobIds }, vehicleId: input.vehicleId, loadAllocations: { none: {} }, ...(isDriver ? { driverId } : {}) },
    include: { serviceRecord: { include: { assetRecords: true } } },
  });
  if (loads.length !== input.jobIds.length) throw badRequest("Some selected loads are not on this truck or are already allocated.");

  return prisma.$transaction(async (tx) => {
    const event = await tx.disposalEvent.create({
      data: {
        eventNumber: await numbers.disposal(tx),
        driverId,
        vehicleId: input.vehicleId,
        facilityId: facility.id,
        disposedAt,
        wasteType: input.wasteType,
        gallons: input.gallons,
        ratePerGallonCents: new Prisma.Decimal(rate),
        totalCostCents: lineAmountCents(String(input.gallons), rate),
        ticketNumber: input.ticketNumber || null,
        openingLoadGallons: input.openingLoadGallons ?? null,
        closingLoadGallons: input.closingLoadGallons ?? null,
        adjustmentGallons: input.adjustmentGallons,
        adjustmentReason: input.adjustmentReason || null,
        facilityAcknowledged: input.facilityAcknowledged,
        notes: input.notes || null,
        recordedById: actor.userId,
        allocations: { create: loads.map((j) => ({ jobId: j.id, gallons: j.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0 })) },
      },
    });
    if (ticket) {
      await storeDocument(tx, { bytes: ticket.bytes, fileName: ticket.name, type: "DISPOSAL_TICKET", title: `Disposal ticket ${input.ticketNumber ?? event.eventNumber}`, disposalEventId: event.id, vehicleId: input.vehicleId, uploadedById: actor.userId });
    }
    await audit(tx, { actorId: actor.userId, action: "disposal.record", entityType: "DisposalEvent", entityId: event.id, after: { ...input, rate } });
    return event;
  });
}

export async function eventReconciliation(eventId: string) {
  const e = await prisma.disposalEvent.findUnique({ where: { id: eventId }, include: { allocations: true } });
  if (!e) throw notFound();
  return reconcileEvent({ gallons: e.gallons, openingLoadGallons: e.openingLoadGallons, closingLoadGallons: e.closingLoadGallons, adjustmentGallons: e.adjustmentGallons, allocatedGallons: e.allocations.reduce((s, a) => s + a.gallons, 0) });
}

/** Per-truck reconciliation for a date range (collected by completion time vs. disposed). */
export async function fleetReconciliation(fromKey: string, toKey: string) {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) throw badRequest("Invalid date range.");
  const from = dateFromKey(fromKey);
  const to = new Date(dateFromKey(toKey).getTime() + 86_400_000);
  const vehicles = await prisma.vehicle.findMany({ orderBy: { unitNumber: "asc" } });
  const out = [];
  for (const v of vehicles) {
    const [collected, events] = await Promise.all([
      prisma.serviceAssetRecord.aggregate({ where: { serviceRecord: { vehicleId: v.id, finishedAt: { gte: from, lt: to }, job: { status: { in: ["SUBMITTED", "COMPLETED"] } } } }, _sum: { gallonsPumped: true } }),
      prisma.disposalEvent.findMany({ where: { vehicleId: v.id, disposedAt: { gte: from, lt: to } }, orderBy: { disposedAt: "asc" } }),
    ]);
    const collectedGallons = collected._sum.gallonsPumped ?? 0;
    if (collectedGallons === 0 && events.length === 0) continue;
    const r = reconcile({
      openingLoadGallons: events[0]?.openingLoadGallons ?? 0,
      closingLoadGallons: events.at(-1)?.closingLoadGallons ?? 0,
      collectedGallons,
      disposedGallons: events.reduce((s, e) => s + e.gallons, 0),
      adjustmentsGallons: events.reduce((s, e) => s + e.adjustmentGallons, 0),
    });
    out.push({ vehicle: v, events: events.length, costCents: events.reduce((s, e) => s + e.totalCostCents, 0), ...r });
  }
  return out;
}

export const facilitySchema = z.object({
  name: z.string().trim().min(2).max(200),
  addressLine1: z.string().trim().min(3).max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/),
  phone: z.string().trim().max(40).optional(),
  permitNumber: z.string().trim().max(80).optional(),
  acceptedWasteTypes: z.array(z.string()).default([]),
  ratePerGallon: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  notes: z.string().trim().max(2000).optional(),
});

export async function upsertFacility(actor: Actor, id: string | null, input: z.infer<typeof facilitySchema>) {
  if (!hasPermission(actor, "settings.write") && !hasPermission(actor, "disposal.write")) throw forbidden();
  const rate = input.ratePerGallon ? parseDollarRateToCentsString(input.ratePerGallon) : null;
  if (input.ratePerGallon && rate === null) throw badRequest("Enter a rate such as 0.06");
  const { ratePerGallon: _r, ...rest } = input;
  void _r;
  const data = { ...rest, phone: rest.phone || null, permitNumber: rest.permitNumber || null, notes: rest.notes || null, ratePerGallonCents: rate ? new Prisma.Decimal(rate) : null };
  return prisma.$transaction(async (tx) => {
    const f = id ? await tx.disposalFacility.update({ where: { id }, data }) : await tx.disposalFacility.create({ data });
    await audit(tx, { actorId: actor.userId, action: id ? "facility.update" : "facility.create", entityType: "DisposalFacility", entityId: f.id, after: data });
    return f;
  });
}
