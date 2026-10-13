import "server-only";
import { z } from "zod";
import { Prisma, type ServicePlan, type RecurrenceRule } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { addDays, compareKeys, dateFromKey, formatDateKey, isDateKey, keyFromDate, todayKey, type DateKey } from "@/lib/dates";
import { firstOccurrenceOnOrAfter, nextOccurrence, validateRule, type Rule } from "@/domain/recurrence";
import { companyTimeZone, getSetting } from "./settings";
import { parseDollarRateToCentsString, parseDollarsToCents } from "@/lib/money";

const dateKey = z.string().refine(isDateKey, "Enter a valid date.");
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .optional()
  .transform((v) => v ?? null);

export const planSchema = z
  .object({
    locationId: z.string().uuid(),
    name: z.string().trim().min(2).max(200),
    serviceType: z.enum(["GREASE_TRAP_PUMPING", "INTERCEPTOR_PUMPING", "SEPTIC_PUMPING", "GRIT_TRAP_CLEANING", "LINT_TRAP_CLEANING", "LIFT_STATION_SERVICE", "HYDRO_JETTING", "LINE_CLEANING", "INSPECTION", "OTHER"]),
    assetIds: z.array(z.string().uuid()).min(1, "Select at least one piece of equipment."),
    unit: z.enum(["DAY", "WEEK", "MONTH", "SPECIFIC_DATES"]),
    interval: z.coerce.number().int().min(1).max(730).default(1),
    anchor: z.enum(["FIXED_CALENDAR", "COMPLETION_DATE"]),
    startDate: dateKey,
    endDate: dateKey.optional(),
    specificDates: z.string().optional(), // comma / newline separated date keys
    preferredWindowStart: hhmm,
    preferredWindowEnd: hhmm,
    pricingModel: z.enum(["PER_GALLON", "FLAT_RATE"]),
    flatPrice: z.string().optional(),
    perGallonPrice: z.string().optional(),
    minimumCharge: z.string().optional(),
    territory: z.string().trim().max(100).optional(),
    defaultDriverId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    defaultVehicleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    specialInstructions: z.string().trim().max(4000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.endDate && compareKeys(v.endDate, v.startDate) < 0) ctx.addIssue({ code: "custom", path: ["endDate"], message: "End date must be after the start date." });
    if (v.pricingModel === "FLAT_RATE" && v.flatPrice && parseDollarsToCents(v.flatPrice) === null) ctx.addIssue({ code: "custom", path: ["flatPrice"], message: "Enter a dollar amount." });
    if (v.pricingModel === "PER_GALLON" && v.perGallonPrice && parseDollarRateToCentsString(v.perGallonPrice) === null) ctx.addIssue({ code: "custom", path: ["perGallonPrice"], message: "Enter a rate such as 0.35" });
    if (v.minimumCharge && parseDollarsToCents(v.minimumCharge) === null) ctx.addIssue({ code: "custom", path: ["minimumCharge"], message: "Enter a dollar amount." });
    if (v.unit === "SPECIFIC_DATES") {
      const dates = parseDateList(v.specificDates ?? "");
      if (!dates || dates.length === 0) ctx.addIssue({ code: "custom", path: ["specificDates"], message: "Enter one or more dates as YYYY-MM-DD." });
    }
  });

function parseDateList(s: string): DateKey[] | null {
  const parts = s.split(/[\s,;]+/).filter(Boolean);
  if (!parts.every(isDateKey)) return null;
  return [...new Set(parts)].sort();
}

export function ruleFromRecord(r: RecurrenceRule): Rule {
  return {
    unit: r.unit,
    interval: r.interval,
    anchor: r.anchor,
    anchorDate: keyFromDate(r.anchorDate),
    specificDates: r.specificDates.map(keyFromDate),
  };
}

function pricingFields(v: z.infer<typeof planSchema>) {
  return {
    pricingModel: v.pricingModel,
    flatPriceCents: v.pricingModel === "FLAT_RATE" && v.flatPrice ? parseDollarsToCents(v.flatPrice) : null,
    perGallonCents: v.pricingModel === "PER_GALLON" && v.perGallonPrice ? new Prisma.Decimal(parseDollarRateToCentsString(v.perGallonPrice)!) : null,
    minimumChargeCents: v.minimumCharge ? parseDollarsToCents(v.minimumCharge) : null,
  };
}

export async function createPlan(actor: Actor, input: z.infer<typeof planSchema>, opts: { db?: Db } = {}) {
  assertStaffActor(actor, "plans.write");
  const tz = await companyTimeZone();
  const rule: Rule = {
    unit: input.unit,
    interval: input.unit === "SPECIFIC_DATES" ? 1 : input.interval,
    anchor: input.unit === "SPECIFIC_DATES" ? "FIXED_CALENDAR" : input.anchor,
    anchorDate: input.startDate,
    specificDates: input.unit === "SPECIFIC_DATES" ? parseDateList(input.specificDates ?? "")! : [],
  };
  const problem = validateRule(rule);
  if (problem) throw badRequest(problem);

  const run = async (tx: Db) => {
    const loc = await tx.serviceLocation.findFirst({ where: { id: input.locationId, deletedAt: null } });
    if (!loc) throw notFound("Location not found.");
    const assets = await tx.serviceAsset.findMany({ where: { id: { in: input.assetIds }, locationId: loc.id, deletedAt: null, status: "ACTIVE" } });
    if (assets.length !== input.assetIds.length) throw badRequest("All equipment must be active and at this location.");

    const today = todayKey(tz);
    const first = firstOccurrenceOnOrAfter(rule, compareKeys(input.startDate, today) > 0 ? input.startDate : today);
    const recurrence = await tx.recurrenceRule.create({
      data: { unit: rule.unit, interval: rule.interval, anchor: rule.anchor, anchorDate: dateFromKey(rule.anchorDate), specificDates: (rule.specificDates ?? []).map(dateFromKey) },
    });
    const plan = await tx.servicePlan.create({
      data: {
        planNumber: await numbers.plan(tx),
        organizationId: loc.organizationId,
        locationId: loc.id,
        name: input.name,
        serviceType: input.serviceType,
        recurrenceRuleId: recurrence.id,
        nextServiceDate: first && (!input.endDate || compareKeys(first, input.endDate) <= 0) ? dateFromKey(first) : null,
        preferredWindowStart: input.preferredWindowStart ?? loc.defaultWindowStart,
        preferredWindowEnd: input.preferredWindowEnd ?? loc.defaultWindowEnd,
        ...pricingFields(input),
        territory: input.territory ?? loc.territory,
        defaultDriverId: input.defaultDriverId ?? null,
        defaultVehicleId: input.defaultVehicleId ?? null,
        specialInstructions: input.specialInstructions ?? null,
        startDate: dateFromKey(input.startDate),
        endDate: input.endDate ? dateFromKey(input.endDate) : null,
        createdById: actor.userId,
        updatedById: actor.userId,
        assets: { create: assets.map((a) => ({ assetId: a.id })) },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "plan.create", entityType: "ServicePlan", entityId: plan.id, organizationId: loc.organizationId, after: { ...input, rule } });
    await materializePlan(tx, plan.id, actor.userId);
    return plan;
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run);
}

export async function updatePlan(actor: Actor, planId: string, input: z.infer<typeof planSchema>, reason?: string) {
  assertStaffActor(actor, "plans.write");
  return prisma.$transaction(async (tx) => {
    const plan = await tx.servicePlan.findUnique({ where: { id: planId }, include: { recurrenceRule: true, assets: true } });
    if (!plan) throw notFound();
    if (plan.locationId !== input.locationId) throw badRequest("A plan cannot be moved to a different location. Create a new plan instead.");
    const assets = await tx.serviceAsset.findMany({ where: { id: { in: input.assetIds }, locationId: plan.locationId, deletedAt: null } });
    if (assets.length !== input.assetIds.length) throw badRequest("All equipment must be at this location.");
    const rule: Rule = {
      unit: input.unit,
      interval: input.unit === "SPECIFIC_DATES" ? 1 : input.interval,
      anchor: input.unit === "SPECIFIC_DATES" ? "FIXED_CALENDAR" : input.anchor,
      anchorDate: input.startDate,
      specificDates: input.unit === "SPECIFIC_DATES" ? parseDateList(input.specificDates ?? "")! : [],
    };
    const problem = validateRule(rule);
    if (problem) throw badRequest(problem);
    const before = { rule: ruleFromRecord(plan.recurrenceRule), name: plan.name, flatPriceCents: plan.flatPriceCents, perGallonCents: plan.perGallonCents?.toString() };
    await tx.recurrenceRule.update({
      where: { id: plan.recurrenceRuleId },
      data: { unit: rule.unit, interval: rule.interval, anchor: rule.anchor, anchorDate: dateFromKey(rule.anchorDate), specificDates: (rule.specificDates ?? []).map(dateFromKey) },
    });
    await tx.servicePlanAsset.deleteMany({ where: { planId } });
    await tx.servicePlan.update({
      where: { id: planId },
      data: {
        name: input.name,
        serviceType: input.serviceType,
        preferredWindowStart: input.preferredWindowStart,
        preferredWindowEnd: input.preferredWindowEnd,
        ...pricingFields(input),
        territory: input.territory ?? null,
        defaultDriverId: input.defaultDriverId ?? null,
        defaultVehicleId: input.defaultVehicleId ?? null,
        specialInstructions: input.specialInstructions ?? null,
        startDate: dateFromKey(input.startDate),
        endDate: input.endDate ? dateFromKey(input.endDate) : null,
        updatedById: actor.userId,
        assets: { create: assets.map((a) => ({ assetId: a.id })) },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "plan.update", entityType: "ServicePlan", entityId: planId, organizationId: plan.organizationId, before, after: { rule, name: input.name }, reason: reason ?? null });
    // The already-materialized upcoming job keeps its date; the new rule applies from the next advance.
  });
}

export async function setPlanStatus(actor: Actor, planId: string, status: "ACTIVE" | "PAUSED" | "ENDED", reason: string) {
  assertStaffActor(actor, "plans.write");
  const tz = await companyTimeZone();
  return prisma.$transaction(async (tx) => {
    const plan = await tx.servicePlan.findUnique({ where: { id: planId }, include: { recurrenceRule: true } });
    if (!plan) throw notFound();
    const data: Prisma.ServicePlanUpdateInput = { status, updatedById: actor.userId };
    if (status === "ACTIVE" && plan.status !== "ACTIVE") {
      // Resume from today: recompute the first future occurrence (missed occurrences are not back-filled).
      const next = firstOccurrenceOnOrAfter(ruleFromRecord(plan.recurrenceRule), todayKey(tz));
      data.nextServiceDate = next ? dateFromKey(next) : null;
    }
    if (status === "ENDED") data.nextServiceDate = null;
    await tx.servicePlan.update({ where: { id: planId }, data });
    if (status !== "ACTIVE") {
      // Cancel the not-yet-started upcoming job so it does not linger on the board.
      const open = await tx.job.findMany({ where: { planId, status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED"] } } });
      for (const j of open) {
        await tx.job.update({ where: { id: j.id }, data: { status: "CANCELLED", cancellationReason: `Plan ${status.toLowerCase()}: ${reason}` } });
        await tx.jobStatusEvent.create({ data: { jobId: j.id, fromStatus: j.status, toStatus: "CANCELLED", actorId: actor.userId, note: `Plan ${status.toLowerCase()}` } });
      }
    }
    await audit(tx, { actorId: actor.userId, action: `plan.${status.toLowerCase()}`, entityType: "ServicePlan", entityId: planId, organizationId: plan.organizationId, before: { status: plan.status }, after: { status }, reason });
    if (status === "ACTIVE") await materializePlan(tx, planId, actor.userId);
  });
}

const OPEN = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "MISSED", "UNABLE_TO_SERVICE"] as const;

/**
 * Ensure the plan's next occurrence exists as a job when it falls inside the scheduling horizon.
 * Idempotent: guarded by "one open job per plan" and the (planId, occurrenceDate) unique key.
 */
export async function materializePlan(db: Db, planId: string, actorId: string | null): Promise<string | null> {
  const plan = await db.servicePlan.findUnique({ where: { id: planId }, include: { assets: true, location: true } });
  if (!plan || plan.status !== "ACTIVE" || !plan.nextServiceDate) return null;
  if (plan.location.status !== "ACTIVE" || plan.location.deletedAt) return null;
  const tz = await companyTimeZone(db);
  const horizon = (await getSetting("scheduling", db)).horizonDays;
  const occurrence = keyFromDate(plan.nextServiceDate);
  if (compareKeys(occurrence, addDays(todayKey(tz), horizon)) > 0) return null;

  const open = await db.job.findFirst({ where: { planId, status: { in: [...OPEN] } } });
  if (open) return open.id;
  const existing = await db.job.findUnique({ where: { planId_occurrenceDate: { planId, occurrenceDate: plan.nextServiceDate } } });
  if (existing) return existing.id;

  const capacity = await db.serviceAsset.aggregate({ where: { id: { in: plan.assets.map((a) => a.assetId) } }, _sum: { capacityGallons: true } });
  const idempotencyKey = `plan:${planId}:${occurrence}`;
  try {
    const job = await db.job.create({
      data: {
        jobNumber: await numbers.job(db),
        organizationId: plan.organizationId,
        locationId: plan.locationId,
        planId,
        occurrenceDate: plan.nextServiceDate,
        type: "RECURRING",
        serviceType: plan.serviceType,
        status: plan.defaultDriverId ? "ASSIGNED" : "SCHEDULED",
        scheduledDate: plan.nextServiceDate,
        windowStart: plan.preferredWindowStart,
        windowEnd: plan.preferredWindowEnd,
        estimatedGallons: capacity._sum.capacityGallons ?? null,
        driverId: plan.defaultDriverId,
        vehicleId: plan.defaultVehicleId,
        instructions: plan.specialInstructions,
        idempotencyKey,
        isDemo: plan.location.isDemo,
        createdById: actorId,
        assets: { create: plan.assets.map((a) => ({ assetId: a.assetId })) },
        statusEvents: { create: { toStatus: plan.defaultDriverId ? "ASSIGNED" : "SCHEDULED", actorId, note: "Generated from recurring plan" } },
        ...(plan.defaultDriverId ? { assignments: { create: { driverId: plan.defaultDriverId, vehicleId: plan.defaultVehicleId, assignedById: actorId, reason: "Plan default driver" } } } : {}),
      },
    });
    const { notify, customerRecipientsForLocation } = await import("./notifications");
    await notify(db, {
      userIds: await customerRecipientsForLocation(db, plan.organizationId, plan.locationId),
      contacts: { organizationId: plan.organizationId, locationId: plan.locationId },
      type: "service.scheduled",
      title: `Service scheduled for ${plan.location.name}`,
      body: `Your next ${plan.name.replace(/ — every \d+ days$/, "").toLowerCase()} is scheduled for ${formatDateKey(occurrence, "long")}. We'll send a reminder before the visit.`,
      link: `/customer/services/${job.id}`,
      entityType: "Job",
      entityId: job.id,
      dedupeKey: `job:${job.id}:scheduled`,
    });
    return job.id;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null; // concurrent creator won
    throw err;
  }
}

/**
 * Move the plan forward after an occurrence is fulfilled or skipped. Idempotent: if the plan has
 * already advanced past this occurrence, nothing happens.
 */
export async function advancePlan(db: Db, job: { planId: string | null; occurrenceDate: Date | null }, completedOn: DateKey | null, actorId: string | null) {
  if (!job.planId || !job.occurrenceDate) return;
  const plan: (ServicePlan & { recurrenceRule: RecurrenceRule }) | null = await db.servicePlan.findUnique({ where: { id: job.planId }, include: { recurrenceRule: true } });
  if (!plan) return;
  const occurrence = keyFromDate(job.occurrenceDate);
  if (plan.nextServiceDate && compareKeys(keyFromDate(plan.nextServiceDate), occurrence) > 0) return; // already advanced
  const next = nextOccurrence(ruleFromRecord(plan.recurrenceRule), occurrence, completedOn);
  const ended = !next || (plan.endDate && compareKeys(next, keyFromDate(plan.endDate)) > 0);
  await db.servicePlan.update({
    where: { id: plan.id },
    data: {
      nextServiceDate: ended ? null : dateFromKey(next!),
      status: ended ? "ENDED" : plan.status,
      ...(completedOn ? { lastCompletedAt: new Date() } : {}),
    },
  });
  if (!ended && plan.status === "ACTIVE") await materializePlan(db, plan.id, actorId);
}

/** Cron: materialize every active plan whose next occurrence entered the horizon. */
export async function materializeAllDuePlans() {
  const tz = await companyTimeZone();
  const horizon = (await getSetting("scheduling")).horizonDays;
  const limit = dateFromKey(addDays(todayKey(tz), horizon));
  const plans = await prisma.servicePlan.findMany({ where: { status: "ACTIVE", nextServiceDate: { lte: limit } }, select: { id: true } });
  let created = 0;
  for (const p of plans) {
    const before = await prisma.job.count({ where: { planId: p.id } });
    await prisma.$transaction((tx) => materializePlan(tx, p.id, null));
    const after = await prisma.job.count({ where: { planId: p.id } });
    created += after - before;
  }
  return { plans: plans.length, created };
}
