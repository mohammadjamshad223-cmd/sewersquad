import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import type { Actor } from "../auth/session";
import { assertDriverActor, assertStaffActor } from "../authz/check";
import { dateFromKey, isDateKey } from "@/lib/dates";
import { notify, staffWithPermission } from "./notifications";
import { storeDocument } from "./documents";
import { numbers } from "../numbering";

const optDate = z.string().optional().refine((v) => !v || isDateKey(v), "Enter a valid date.").transform((v) => (v ? dateFromKey(v) : null));
const optStr = (max = 200) => z.string().trim().max(max).optional().transform((v) => v || null);

export const vehicleSchema = z.object({
  unitNumber: z.string().trim().min(1).max(40),
  vin: z.string().trim().toUpperCase().regex(/^[A-HJ-NPR-Z0-9]{17}$/, "VIN must be 17 characters (no I, O or Q).").optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null),
  licensePlate: optStr(20),
  make: optStr(60),
  model: optStr(60),
  year: z.coerce.number().int().min(1980).max(2100).optional().nullable(),
  tankCapacityGallons: z.coerce.number().int().min(1, "Tank capacity is required.").max(20_000),
  status: z.enum(["AVAILABLE", "ASSIGNED", "IN_SERVICE", "MAINTENANCE", "OUT_OF_SERVICE"]),
  registrationExpiry: optDate,
  insuranceExpiry: optDate,
  permitNumber: optStr(60),
  permitExpiry: optDate,
  costPerHour: z.string().optional(),
  notes: optStr(2000),
});

export async function upsertVehicle(actor: Actor, id: string | null, input: z.infer<typeof vehicleSchema>) {
  assertStaffActor(actor, "fleet.write");
  const { parseDollarsToCents } = await import("@/lib/money");
  const { costPerHour, ...rest } = input;
  const data = { ...rest, costPerHourCents: costPerHour ? parseDollarsToCents(costPerHour) : null };
  return prisma.$transaction(async (tx) => {
    const before = id ? await tx.vehicle.findUnique({ where: { id } }) : null;
    if (id && !before) throw notFound();
    const v = id ? await tx.vehicle.update({ where: { id }, data }) : await tx.vehicle.create({ data });
    await audit(tx, { actorId: actor.userId, action: id ? "vehicle.update" : "vehicle.create", entityType: "Vehicle", entityId: v.id, before, after: data });
    return v;
  });
}

export async function addMaintenance(actor: Actor, vehicleId: string, input: { performedOn: string; category: string; description: string; cost?: string; odometer?: number | null; vendor?: string }) {
  assertStaffActor(actor, "fleet.write");
  if (!isDateKey(input.performedOn)) throw badRequest("Enter a valid date.");
  const { parseDollarsToCents } = await import("@/lib/money");
  await prisma.$transaction(async (tx) => {
    const m = await tx.vehicleMaintenance.create({ data: { vehicleId, performedOn: dateFromKey(input.performedOn), category: input.category, description: input.description, costCents: input.cost ? parseDollarsToCents(input.cost) : null, odometer: input.odometer ?? null, vendor: input.vendor || null, createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "vehicle.maintenance", entityType: "Vehicle", entityId: vehicleId, after: m });
  });
}

export const driverSchema = z.object({
  status: z.enum(["ACTIVE", "ON_LEAVE", "INACTIVE"]),
  licenseNumber: optStr(40),
  licenseClass: optStr(10),
  licenseExpiry: optDate,
  territory: optStr(100),
  hireDate: optDate,
  hourlyCost: z.string().optional(),
  defaultVehicleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null),
  phone: optStr(40),
});

export async function updateDriver(actor: Actor, driverId: string, input: z.infer<typeof driverSchema>) {
  assertStaffActor(actor, "fleet.write");
  const { parseDollarsToCents } = await import("@/lib/money");
  const { hourlyCost, phone, ...rest } = input;
  return prisma.$transaction(async (tx) => {
    const before = await tx.driver.findUnique({ where: { id: driverId } });
    if (!before) throw notFound();
    await tx.driver.update({ where: { id: driverId }, data: { ...rest, hourlyCostCents: hourlyCost ? parseDollarsToCents(hourlyCost) : null } });
    if (phone !== undefined) await tx.user.update({ where: { id: before.userId }, data: { phone } });
    await audit(tx, { actorId: actor.userId, action: "driver.update", entityType: "Driver", entityId: driverId, before, after: input });
  });
}

/** Configurable checklist. Operational aid only — not a substitute for legally required inspections. */
export const DEFAULT_INSPECTION_ITEMS = [
  { key: "brakes", label: "Brakes & air system" },
  { key: "lights", label: "Lights, signals & reflectors" },
  { key: "tires", label: "Tires, wheels & lug nuts" },
  { key: "mirrors", label: "Mirrors & windshield" },
  { key: "fluids", label: "Fluid levels & leaks" },
  { key: "horn_wipers", label: "Horn & wipers" },
  { key: "pump", label: "Vacuum pump & PTO" },
  { key: "hoses", label: "Hoses, valves & fittings" },
  { key: "tank", label: "Tank, hatches & seals" },
  { key: "spill_kit", label: "Spill kit & PPE on board" },
  { key: "fire_ext", label: "Fire extinguisher & triangles" },
  { key: "docs", label: "Registration, insurance & permits on board" },
] as const;

export const inspectionSchema = z.object({
  vehicleId: z.string().uuid("Select a truck."),
  type: z.enum(["PRE_TRIP", "POST_TRIP"]),
  odometer: z.coerce.number().int().min(0).max(5_000_000).optional().nullable(),
  items: z.array(z.object({ key: z.string(), label: z.string(), result: z.enum(["PASS", "FAIL", "NA"]), note: z.string().max(500).optional() })).min(1),
  comments: z.string().trim().max(2000).optional(),
  acknowledgedBy: z.string().trim().min(2, "Type your name to acknowledge."),
});

export async function submitInspection(actor: Actor, input: z.infer<typeof inspectionSchema>, photos: { bytes: Uint8Array; name: string }[]) {
  const driver = assertDriverActor(actor);
  const vehicle = await prisma.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) throw notFound("Truck not found.");
  const failed = input.items.filter((i) => i.result === "FAIL");
  if (failed.some((f) => !f.note || f.note.trim().length < 3)) throw badRequest("Describe each failed item.");
  return prisma.$transaction(async (tx) => {
    const insp = await tx.vehicleInspection.create({
      data: {
        vehicleId: vehicle.id,
        driverId: driver.driverId,
        type: input.type,
        odometer: input.odometer ?? null,
        items: input.items,
        hasDefects: failed.length > 0,
        defectsSummary: failed.length ? failed.map((f) => `${f.label}: ${f.note}`).join("; ") : null,
        comments: input.comments ?? null,
        acknowledgedBy: input.acknowledgedBy,
        acknowledgedAt: new Date(),
      },
    });
    for (const p of photos.slice(0, 8)) await storeDocument(tx, { bytes: p.bytes, fileName: p.name, type: "INSPECTION", title: `Inspection photo — ${vehicle.unitNumber}`, inspectionId: insp.id, vehicleId: vehicle.id, uploadedById: actor.userId, imagesOnly: true });
    if (failed.length) {
      const report = await tx.issueReport.create({ data: { reportNumber: await numbers.issue(tx), reportedById: actor.userId, vehicleId: vehicle.id, category: "VEHICLE", severity: "HIGH", description: `Inspection defects on ${vehicle.unitNumber}: ${insp.defectsSummary}` } });
      await notify(tx, { userIds: await staffWithPermission(tx, "fleet.write"), type: "admin.issue", title: `Inspection defects: truck ${vehicle.unitNumber}`, body: insp.defectsSummary!, link: `/admin/fleet/${vehicle.id}`, entityType: "IssueReport", entityId: report.id, dedupeKey: `issue:${report.id}` });
    }
    await audit(tx, { actorId: actor.userId, action: "inspection.submit", entityType: "VehicleInspection", entityId: insp.id, after: { vehicleId: vehicle.id, type: input.type, defects: failed.length } });
    return insp;
  });
}

export async function resolveIssue(actor: Actor, issueId: string, status: "ACKNOWLEDGED" | "RESOLVED", resolution?: string) {
  assertStaffActor(actor, ["fleet.write", "jobs.dispatch"]);
  const i = await prisma.issueReport.findUnique({ where: { id: issueId } });
  if (!i) throw notFound();
  if (status === "RESOLVED" && (!resolution || resolution.trim().length < 3)) throw badRequest("Describe the resolution.");
  await prisma.$transaction(async (tx) => {
    await tx.issueReport.update({ where: { id: issueId }, data: { status, resolution: resolution ?? i.resolution, ...(status === "RESOLVED" ? { resolvedById: actor.userId, resolvedAt: new Date() } : {}) } });
    await audit(tx, { actorId: actor.userId, action: `issue.${status.toLowerCase()}`, entityType: "IssueReport", entityId: issueId, reason: resolution ?? null });
  });
}

/**
 * Field mode for office staff (e.g. an owner-operator who also runs jobs): gives a staff account
 * a driver profile so it can be assigned jobs and use the driver portal. Turning it off marks the
 * profile inactive; its job history is kept.
 */
export async function setStaffFieldProfile(actor: Actor, userId: string, enabled: boolean) {
  assertStaffActor(actor, "staff.manage");
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { driver: true, role: true } });
  if (!user || user.kind !== "STAFF") throw notFound("Staff member not found.");
  if (user.role?.key === "super_admin" && actor.roleKey !== "super_admin") throw badRequest("Only a Super Admin can change another Super Admin.");
  return prisma.$transaction(async (tx) => {
    let driver = user.driver;
    if (enabled) {
      driver = driver
        ? await tx.driver.update({ where: { id: driver.id }, data: { status: "ACTIVE" } })
        : await tx.driver.create({ data: { userId, employeeNumber: await numbers.employee(tx) } });
    } else if (driver) {
      const open = await tx.job.count({ where: { driverId: driver.id, status: { in: ["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"] } } });
      if (open) throw badRequest(`Reassign this person's ${open} open job${open > 1 ? "s" : ""} first.`);
      driver = await tx.driver.update({ where: { id: driver.id }, data: { status: "INACTIVE" } });
    }
    await audit(tx, { actorId: actor.userId, action: enabled ? "staff.field_mode_on" : "staff.field_mode_off", entityType: "User", entityId: userId, after: { driverId: driver?.id ?? null } });
    return driver;
  });
}
