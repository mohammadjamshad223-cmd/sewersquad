import "server-only";
import { z } from "zod";
import type { JobStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertDriverActor, assertStaffActor } from "../authz/guards";
import { assertTransition, emergencyStatusForJob, TransitionError, type TransitionActor } from "@/domain/job-state";
import { compareKeys, dateFromKey, formatDateKey, formatWindow, isDateKey, keyFromDate, todayKey } from "@/lib/dates";
import { advancePlan } from "./plans";
import { customerRecipientsForLocation, notify, staffWithPermission } from "./notifications";
import { companyTimeZone } from "./settings";

const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
  .optional()
  .transform((v) => v ?? null);

export const jobSchema = z.object({
  locationId: z.string().uuid(),
  serviceType: z.enum(["GREASE_TRAP_PUMPING", "INTERCEPTOR_PUMPING", "SEPTIC_PUMPING", "GRIT_TRAP_CLEANING", "LINT_TRAP_CLEANING", "LIFT_STATION_SERVICE", "HYDRO_JETTING", "LINE_CLEANING", "INSPECTION", "OTHER"]),
  type: z.enum(["ONE_TIME", "EMERGENCY"]).default("ONE_TIME"),
  priority: z.enum(["NORMAL", "HIGH", "EMERGENCY"]).default("NORMAL"),
  scheduledDate: z.string().refine(isDateKey, "Enter a valid date."),
  windowStart: hhmm,
  windowEnd: hhmm,
  assetIds: z.array(z.string().uuid()).default([]),
  estimatedGallons: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  driverId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  vehicleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  instructions: z.string().trim().max(4000).optional(),
  internalNotes: z.string().trim().max(4000).optional(),
  quotedPrice: z.string().optional(),
});

function toAppError(err: unknown): never {
  if (err instanceof TransitionError) throw badRequest(err.message);
  throw err;
}

async function recordTransition(db: Db, job: { id: string; status: JobStatus }, to: JobStatus, by: TransitionActor, actorId: string | null, extra?: { note?: string | null; latitude?: number | null; longitude?: number | null }) {
  try {
    assertTransition(job.status, to, by);
  } catch (e) {
    toAppError(e);
  }
  // Optimistic concurrency: only move from the status we read.
  const res = await db.job.updateMany({ where: { id: job.id, status: job.status }, data: { status: to, updatedById: actorId } });
  if (res.count !== 1) throw conflict("This job was updated by someone else. Refresh and try again.");
  await db.jobStatusEvent.create({ data: { jobId: job.id, fromStatus: job.status, toStatus: to, actorId, note: extra?.note ?? null, latitude: extra?.latitude ?? null, longitude: extra?.longitude ?? null } });
  await syncEmergencyForJob(db, job.id, to, actorId);
}

export async function syncEmergencyForJob(db: Db, jobId: string, jobStatus: JobStatus, actorId: string | null) {
  const er = await db.emergencyRequest.findUnique({ where: { jobId } });
  if (!er) return;
  const next = emergencyStatusForJob(jobStatus);
  if (!next || next === er.status || er.status === "COMPLETED" || er.status === "CANCELLED") return;
  await db.emergencyRequest.update({ where: { id: er.id }, data: { status: next, ...(next === "COMPLETED" ? { closedAt: new Date() } : {}) } });
  await db.emergencyRequestEvent.create({ data: { emergencyRequestId: er.id, fromStatus: er.status, toStatus: next, actorId, note: null } });
}

// ── Creation ─────────────────────────────────────────────────────────────────

export async function createJob(actor: Actor, input: z.infer<typeof jobSchema>, opts: { emergencyRequestId?: string; db?: Db } = {}) {
  assertStaffActor(actor, "jobs.write");
  const run = async (tx: Db) => {
    const loc = await tx.serviceLocation.findFirst({ where: { id: input.locationId, deletedAt: null } });
    if (!loc) throw notFound("Location not found.");
    if (loc.status !== "ACTIVE") throw badRequest("This location is inactive.");
    const assets = input.assetIds.length ? await tx.serviceAsset.findMany({ where: { id: { in: input.assetIds }, locationId: loc.id, deletedAt: null } }) : [];
    if (assets.length !== input.assetIds.length) throw badRequest("Equipment must belong to this location.");
    if (input.vehicleId && !input.driverId) throw badRequest("Assign a driver along with the truck.");
    if (input.driverId) await assertDriverAndVehicle(tx, input.driverId, input.vehicleId ?? null);
    const { parseDollarsToCents } = await import("@/lib/money");
    const status: JobStatus = input.driverId ? "ASSIGNED" : "SCHEDULED";
    const job = await tx.job.create({
      data: {
        jobNumber: await numbers.job(tx),
        organizationId: loc.organizationId,
        locationId: loc.id,
        type: input.type,
        serviceType: input.serviceType,
        priority: input.type === "EMERGENCY" ? "EMERGENCY" : input.priority,
        status,
        scheduledDate: dateFromKey(input.scheduledDate),
        windowStart: input.windowStart ?? loc.defaultWindowStart,
        windowEnd: input.windowEnd ?? loc.defaultWindowEnd,
        confirmedByOffice: true,
        estimatedGallons: input.estimatedGallons ?? (assets.reduce((s, a) => s + a.capacityGallons, 0) || null),
        driverId: input.driverId ?? null,
        vehicleId: input.vehicleId ?? null,
        instructions: input.instructions ?? null,
        internalNotes: input.internalNotes ?? null,
        quotedPriceCents: input.quotedPrice ? parseDollarsToCents(input.quotedPrice) : null,
        isDemo: loc.isDemo,
        createdById: actor.userId,
        assets: { create: assets.map((a) => ({ assetId: a.id })) },
        statusEvents: { create: { toStatus: status, actorId: actor.userId, note: "Job created" } },
        ...(input.driverId ? { assignments: { create: { driverId: input.driverId, vehicleId: input.vehicleId ?? null, assignedById: actor.userId } } } : {}),
      },
    });
    await audit(tx, { actorId: actor.userId, action: "job.create", entityType: "Job", entityId: job.id, organizationId: loc.organizationId, after: input });
    await notify(tx, {
      userIds: await customerRecipientsForLocation(tx, loc.organizationId, loc.id),
      type: "service.scheduled",
      title: `Service scheduled for ${loc.name}`,
      body: `A ${input.type === "EMERGENCY" ? "dispatch" : "service visit"} is scheduled for ${formatDateKey(input.scheduledDate, "long")}, ${formatWindow(job.windowStart, job.windowEnd)}.`,
      link: `/customer/services/${job.id}`,
      entityType: "Job",
      entityId: job.id,
      dedupeKey: `job:${job.id}:scheduled`,
    });
    if (input.driverId) await notifyDriverAssigned(tx, job.id);
    return job;
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run);
}

async function assertDriverAndVehicle(db: Db, driverId: string, vehicleId: string | null) {
  const driver = await db.driver.findUnique({ where: { id: driverId }, include: { user: true } });
  if (!driver || driver.status !== "ACTIVE" || driver.user.status !== "ACTIVE") throw badRequest("Driver is not active.");
  if (vehicleId) {
    const v = await db.vehicle.findUnique({ where: { id: vehicleId } });
    if (!v) throw badRequest("Truck not found.");
    if (v.status === "MAINTENANCE" || v.status === "OUT_OF_SERVICE") throw badRequest(`Truck ${v.unitNumber} is ${v.status.replace(/_/g, " ").toLowerCase()}.`);
  }
}

async function notifyDriverAssigned(db: Db, jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { driver: true, location: true } });
  if (!job.driver) return;
  const emergency = job.type === "EMERGENCY";
  await notify(db, {
    userIds: [job.driver.userId],
    type: emergency ? "emergency.assigned" : "job.assigned",
    title: emergency ? `Emergency dispatch: ${job.location.name}` : `New job: ${job.location.name}`,
    body: `${job.jobNumber} · ${formatDateKey(job.scheduledDate, "weekday")} · ${formatWindow(job.windowStart, job.windowEnd)} · ${job.location.addressLine1}, ${job.location.city}`,
    link: `/driver/jobs/${job.id}`,
    entityType: "Job",
    entityId: job.id,
    dedupeKey: `job:${job.id}:assigned:${job.driverId}:${job.updatedAt.getTime()}`,
  });
}

// ── Dispatch ─────────────────────────────────────────────────────────────────

const REASSIGNABLE: JobStatus[] = ["SCHEDULED", "ASSIGNED", "ACCEPTED"];

export async function assignJob(actor: Actor, jobId: string, driverId: string | null, vehicleId: string | null, reason?: string) {
  assertStaffActor(actor, "jobs.dispatch");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job) throw notFound();
    if (!REASSIGNABLE.includes(job.status)) throw badRequest("Only jobs that have not started can be reassigned.");
    if (driverId) await assertDriverAndVehicle(tx, driverId, vehicleId);
    const previousDriver = job.driverId ? await tx.driver.findUnique({ where: { id: job.driverId } }) : null;

    await tx.jobAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
    if (driverId) await tx.jobAssignment.create({ data: { jobId, driverId, vehicleId, assignedById: actor.userId, reason: reason ?? null } });

    const targetStatus: JobStatus = driverId ? "ASSIGNED" : "SCHEDULED";
    await tx.job.update({ where: { id: jobId }, data: { driverId, vehicleId: driverId ? vehicleId : null, routeOrder: driverId === job.driverId ? job.routeOrder : null, updatedById: actor.userId } });
    if (job.status !== targetStatus) {
      await recordTransition(tx, { id: jobId, status: job.status }, targetStatus, "dispatch", actor.userId, { note: reason ?? null });
    } else if (job.driverId !== driverId) {
      await tx.jobStatusEvent.create({ data: { jobId, fromStatus: job.status, toStatus: targetStatus, actorId: actor.userId, note: "Reassigned" } });
    }
    await audit(tx, {
      actorId: actor.userId,
      action: job.driverId && job.driverId !== driverId ? "job.reassign" : "job.assign",
      entityType: "Job",
      entityId: jobId,
      organizationId: job.organizationId,
      before: { driverId: job.driverId, vehicleId: job.vehicleId },
      after: { driverId, vehicleId },
      reason: reason ?? null,
    });
    if (driverId && driverId !== job.driverId) await notifyDriverAssigned(tx, jobId);
    if (previousDriver && previousDriver.id !== driverId) {
      await notify(tx, {
        userIds: [previousDriver.userId],
        type: "job.cancelled",
        title: `Removed from ${job.jobNumber}`,
        body: "Dispatch reassigned this job. It is no longer on your route.",
        link: "/driver/route",
        entityType: "Job",
        entityId: jobId,
        dedupeKey: `job:${jobId}:unassigned:${previousDriver.id}:${Date.now()}`,
      });
    }
  });
}

export async function rescheduleJob(actor: Actor, jobId: string, input: { date: string; windowStart?: string | null; windowEnd?: string | null; reason: string; keepDriver?: boolean }) {
  assertStaffActor(actor, "jobs.write");
  if (!isDateKey(input.date)) throw badRequest("Enter a valid date.");
  if (input.reason.trim().length < 3) throw badRequest("A reason is required when rescheduling.");
  const tz = await companyTimeZone();
  if (compareKeys(input.date, todayKey(tz)) < 0) throw badRequest("New date cannot be in the past.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { location: true, driver: true } });
    if (!job) throw notFound();
    const reschedulable: JobStatus[] = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "MISSED", "UNABLE_TO_SERVICE"];
    if (!reschedulable.includes(job.status)) throw badRequest("This job can no longer be rescheduled.");
    const keepDriver = input.keepDriver !== false && job.driverId && ["ASSIGNED", "ACCEPTED"].includes(job.status);
    const before = { scheduledDate: keyFromDate(job.scheduledDate), windowStart: job.windowStart, windowEnd: job.windowEnd, driverId: job.driverId };
    await tx.job.update({
      where: { id: jobId },
      data: {
        scheduledDate: dateFromKey(input.date),
        windowStart: input.windowStart ?? job.windowStart,
        windowEnd: input.windowEnd ?? job.windowEnd,
        routeOrder: null,
        ...(keepDriver ? {} : { driverId: null, vehicleId: null }),
        updatedById: actor.userId,
      },
    });
    if (!keepDriver) {
      await tx.jobAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
      if (job.status !== "SCHEDULED") await recordTransition(tx, job, "SCHEDULED", "dispatch", actor.userId, { note: `Rescheduled: ${input.reason}` });
    } else {
      await tx.jobStatusEvent.create({ data: { jobId, fromStatus: job.status, toStatus: job.status, actorId: actor.userId, note: `Rescheduled to ${input.date}: ${input.reason}` } });
    }
    await audit(tx, { actorId: actor.userId, action: "job.reschedule", entityType: "Job", entityId: jobId, organizationId: job.organizationId, before, after: { scheduledDate: input.date, windowStart: input.windowStart, windowEnd: input.windowEnd }, reason: input.reason });
    const stamp = Date.now();
    await notify(tx, {
      userIds: await customerRecipientsForLocation(tx, job.organizationId, job.locationId),
      type: "service.scheduled",
      title: `Service rescheduled: ${job.location.name}`,
      body: `Your service visit has moved to ${formatDateKey(input.date, "long")}, ${formatWindow(input.windowStart ?? job.windowStart, input.windowEnd ?? job.windowEnd)}.`,
      link: `/customer/services/${jobId}`,
      entityType: "Job",
      entityId: jobId,
      dedupeKey: `job:${jobId}:rescheduled:${stamp}`,
    });
    if (job.driver) {
      await notify(tx, {
        userIds: [job.driver.userId],
        type: keepDriver ? "job.changed" : "job.cancelled",
        title: keepDriver ? `Schedule changed: ${job.jobNumber}` : `Removed from ${job.jobNumber}`,
        body: keepDriver ? `Now ${formatDateKey(input.date, "weekday")}, ${formatWindow(input.windowStart ?? job.windowStart, input.windowEnd ?? job.windowEnd)}.` : "This job was rescheduled and removed from your route.",
        link: keepDriver ? `/driver/jobs/${jobId}` : "/driver/route",
        entityType: "Job",
        entityId: jobId,
        dedupeKey: `job:${jobId}:driver-change:${stamp}`,
      });
    }
  });
}

/**
 * Cancel a job. For a recurring occurrence this skips that occurrence and advances the plan;
 * to keep the occurrence, reschedule instead.
 */
export async function cancelJob(actor: Actor, jobId: string, reason: string) {
  assertStaffActor(actor, "jobs.write");
  if (reason.trim().length < 3) throw badRequest("A reason is required to cancel a job.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { driver: true, location: true } });
    if (!job) throw notFound();
    await recordTransition(tx, job, "CANCELLED", "dispatch", actor.userId, { note: reason });
    await tx.job.update({ where: { id: jobId }, data: { cancellationReason: reason } });
    await tx.jobAssignment.updateMany({ where: { jobId, endedAt: null }, data: { endedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "job.cancel", entityType: "Job", entityId: jobId, organizationId: job.organizationId, before: { status: job.status }, after: { status: "CANCELLED" }, reason });
    await advancePlan(tx, job, null, actor.userId);
    if (job.driver) {
      await notify(tx, { userIds: [job.driver.userId], type: "job.cancelled", title: `Job cancelled: ${job.jobNumber}`, body: `${job.location.name} — ${reason}`, link: "/driver/route", entityType: "Job", entityId: jobId, dedupeKey: `job:${jobId}:cancelled` });
    }
    await notify(tx, {
      userIds: await customerRecipientsForLocation(tx, job.organizationId, job.locationId),
      type: "service.scheduled",
      title: `Service cancelled: ${job.location.name}`,
      body: `The visit scheduled for ${formatDateKey(job.scheduledDate, "long")} was cancelled. Contact us with any questions.`,
      link: `/customer/services/${jobId}`,
      entityType: "Job",
      entityId: jobId,
      dedupeKey: `job:${jobId}:cancelled`,
    });
  });
}

export async function markMissed(actor: Actor, jobId: string, note: string) {
  assertStaffActor(actor, "jobs.write");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job) throw notFound();
    await recordTransition(tx, job, "MISSED", "dispatch", actor.userId, { note });
    await audit(tx, { actorId: actor.userId, action: "job.missed", entityType: "Job", entityId: jobId, organizationId: job.organizationId, reason: note });
  });
}

export async function updateJobDetails(actor: Actor, jobId: string, input: { instructions?: string | null; internalNotes?: string | null; estimatedGallons?: number | null; priority?: "NORMAL" | "HIGH" | "EMERGENCY"; confirmedByOffice?: boolean }) {
  assertStaffActor(actor, "jobs.write");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId } });
    if (!job) throw notFound();
    await tx.job.update({ where: { id: jobId }, data: { ...input, updatedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "job.update", entityType: "Job", entityId: jobId, organizationId: job.organizationId, before: { instructions: job.instructions, internalNotes: job.internalNotes, estimatedGallons: job.estimatedGallons, priority: job.priority }, after: input });
  });
}

/** Persist the stop order of one driver's route for one day. */
export async function reorderRoute(actor: Actor, driverId: string, date: string, orderedJobIds: string[]) {
  assertStaffActor(actor, "jobs.dispatch");
  if (!isDateKey(date)) throw badRequest("Invalid date.");
  return prisma.$transaction(async (tx) => {
    const jobs = await tx.job.findMany({ where: { driverId, scheduledDate: dateFromKey(date) }, select: { id: true } });
    const ids = new Set(jobs.map((j) => j.id));
    if (orderedJobIds.some((id) => !ids.has(id))) throw badRequest("Route contains a job that is not assigned to this driver on this day.");
    for (const [i, id] of orderedJobIds.entries()) await tx.job.update({ where: { id }, data: { routeOrder: i + 1 } });
    await audit(tx, { actorId: actor.userId, action: "route.reorder", entityType: "Driver", entityId: driverId, after: { date, orderedJobIds } });
  });
}

/** Move a job to another date from the dispatch board (keeps assignment when possible). */
export async function moveJobDate(actor: Actor, jobId: string, date: string) {
  return rescheduleJob(actor, jobId, { date, reason: "Moved on dispatch board", keepDriver: true });
}

// ── Driver-side transitions ──────────────────────────────────────────────────

export async function getDriverJob(actor: Actor, jobId: string, db: Db = prisma) {
  const driver = assertDriverActor(actor);
  const job = await db.job.findFirst({ where: { id: jobId, driverId: driver.driverId } });
  if (!job) throw notFound();
  return job;
}

export async function driverTransition(actor: Actor, jobId: string, to: "ACCEPTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "UNABLE_TO_SERVICE", extra: { note?: string; latitude?: number | null; longitude?: number | null } = {}) {
  const driver = assertDriverActor(actor);
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: { id: jobId, driverId: driver.driverId }, include: { location: true } });
    if (!job) throw notFound();
    if (to === "UNABLE_TO_SERVICE" && (!extra.note || extra.note.trim().length < 5)) throw badRequest("Describe why the job could not be serviced.");
    // Allow ASSIGNED → EN_ROUTE in one tap by recording the implicit acceptance.
    if (to === "EN_ROUTE" && job.status === "ASSIGNED") {
      await recordTransition(tx, job, "ACCEPTED", "driver", actor.userId);
      job.status = "ACCEPTED";
    }
    await recordTransition(tx, job, to, "driver", actor.userId, extra);

    if (to === "EN_ROUTE") {
      await notify(tx, {
        userIds: await customerRecipientsForLocation(tx, job.organizationId, job.locationId),
        type: "service.en_route",
        title: `Your Sewer Squad driver is on the way`,
        body: `A driver is en route to ${job.location.name} for ${job.jobNumber}.`,
        link: `/customer/services/${job.id}`,
        entityType: "Job",
        entityId: job.id,
        dedupeKey: `job:${job.id}:en_route`,
      });
    }
    if (to === "ARRIVED" || to === "IN_PROGRESS") {
      const now = new Date();
      await tx.serviceRecord.upsert({
        where: { jobId },
        create: { jobId, driverId: driver.driverId, vehicleId: job.vehicleId, arrivedAt: now, ...(to === "IN_PROGRESS" ? { startedAt: now } : {}) },
        update: to === "IN_PROGRESS" ? { startedAt: now } : { arrivedAt: now },
      });
    }
    if (to === "UNABLE_TO_SERVICE") {
      const report = await tx.issueReport.create({
        data: { reportNumber: await numbers.issue(tx), reportedById: actor.userId, jobId, vehicleId: job.vehicleId, category: "ACCESS", severity: "HIGH", description: extra.note! },
      });
      await notify(tx, {
        userIds: await staffWithPermission(tx, "jobs.dispatch"),
        type: "admin.issue",
        title: `Unable to service ${job.location.name}`,
        body: `${actor.name}: ${extra.note}`,
        link: `/admin/jobs/${job.id}`,
        entityType: "IssueReport",
        entityId: report.id,
        dedupeKey: `issue:${report.id}`,
      });
    }
  });
}

// ── Queries ──────────────────────────────────────────────────────────────────

export const jobListInclude = {
  location: { select: { id: true, name: true, addressLine1: true, city: true, postalCode: true, latitude: true, longitude: true, territory: true } },
  organization: { select: { id: true, name: true } },
  driver: { select: { id: true, user: { select: { name: true } } } },
  vehicle: { select: { id: true, unitNumber: true, tankCapacityGallons: true } },
  assets: { include: { asset: { select: { id: true, assetTag: true, type: true, capacityGallons: true, name: true } } } },
} satisfies Prisma.JobInclude;

export async function listJobs(params: { q?: string; status?: string; from?: string; to?: string; driverId?: string; organizationId?: string; type?: string; page: number; pageSize?: number }) {
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.JobWhereInput = {
    ...(params.status === "OPEN"
      ? { status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"] } }
      : params.status === "UNASSIGNED"
        ? { status: "SCHEDULED", driverId: null }
        : params.status
          ? { status: params.status as JobStatus }
          : {}),
    ...(params.type ? { type: params.type as Prisma.EnumJobTypeFilter["equals"] } : {}),
    ...(params.driverId ? { driverId: params.driverId } : {}),
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    ...(params.from || params.to
      ? { scheduledDate: { ...(params.from && isDateKey(params.from) ? { gte: dateFromKey(params.from) } : {}), ...(params.to && isDateKey(params.to) ? { lte: dateFromKey(params.to) } : {}) } }
      : {}),
    ...(params.q
      ? {
          OR: [
            { jobNumber: { contains: params.q, mode: "insensitive" } },
            { location: { name: { contains: params.q, mode: "insensitive" } } },
            { location: { addressLine1: { contains: params.q, mode: "insensitive" } } },
            { organization: { name: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.job.findMany({ where, orderBy: [{ scheduledDate: params.status === "COMPLETED" ? "desc" : "asc" }, { routeOrder: "asc" }, { windowStart: "asc" }], skip: (params.page - 1) * pageSize, take: pageSize, include: jobListInclude }),
    prisma.job.count({ where }),
  ]);
  return { items, total, pageSize };
}

export async function jobDetail(jobId: string) {
  return prisma.job.findUnique({
    where: { id: jobId },
    include: {
      ...jobListInclude,
      location: true,
      organization: { select: { id: true, name: true, accountNumber: true, primaryPhone: true } },
      plan: { include: { recurrenceRule: true } },
      statusEvents: { orderBy: { occurredAt: "asc" } },
      assignments: { orderBy: { assignedAt: "desc" }, include: { driver: { include: { user: { select: { name: true } } } }, vehicle: true } },
      serviceRecord: { include: { assetRecords: { include: { asset: true } } } },
      manifest: { include: { signatures: true } },
      invoices: { select: { id: true, invoiceNumber: true, status: true, totalCents: true, balanceCents: true } },
      charges: true,
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } },
      emergencyRequest: { select: { id: true, requestNumber: true, status: true } },
      issues: { orderBy: { createdAt: "desc" } },
    },
  });
}
