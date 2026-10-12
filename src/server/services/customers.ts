import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit, diff } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";

// ── Validation schemas (shared with server actions) ──────────────────────────

const optStr = (max = 500) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));
const phone = z
  .string()
  .trim()
  .max(40)
  .regex(/^[\d+().\-\s x]*$/, "Use digits and + ( ) - only.")
  .optional()
  .transform((v) => (v ? v : null));
const email = z.string().trim().toLowerCase().email("Enter a valid email.").optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null);
const hhmm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM")
  .optional()
  .transform((v) => v ?? null);

export const organizationSchema = z.object({
  name: z.string().trim().min(2, "Name is required.").max(200),
  type: z.enum(["RESTAURANT_GROUP", "RESTAURANT", "HOTEL", "HOSPITAL", "SCHOOL", "GROCERY", "INSTITUTIONAL", "OTHER"]),
  billingMode: z.enum(["CONSOLIDATED", "PER_LOCATION"]),
  primaryEmail: email,
  primaryPhone: phone,
  website: optStr(200),
  notes: optStr(4000),
  accountRepId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null),
});

export const locationSchema = z.object({
  name: z.string().trim().min(2, "Name is required.").max(200),
  addressLine1: z.string().trim().min(3, "Address is required.").max(200),
  addressLine2: optStr(200),
  city: z.string().trim().min(2, "City is required.").max(100),
  state: z.string().trim().length(2, "Use the 2-letter state code.").toUpperCase(),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code."),
  county: optStr(100),
  siteContactName: optStr(200),
  siteContactPhone: phone,
  siteContactEmail: email,
  accessInstructions: optStr(4000),
  specialRequirements: optStr(4000),
  territory: optStr(100),
  defaultWindowStart: hhmm,
  defaultWindowEnd: hhmm,
  latitude: z.coerce.number().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().min(-180).max(180).optional().nullable(),
  billingProfileId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null),
  manifestFee: z.enum(["NONE", "STANDARD", "CITY_OF_HOUSTON", "WAIVED"]).default("NONE"),
});

export const contactSchema = z.object({
  locationId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null),
  name: z.string().trim().min(2).max(200),
  title: optStr(120),
  email,
  phone,
  isPrimary: z.coerce.boolean().optional().default(false),
  receivesInvoices: z.coerce.boolean().optional().default(false),
  receivesReminders: z.coerce.boolean().optional().default(false),
  smsOptIn: z.coerce.boolean().optional().default(false),
  smsOptInSource: optStr(200),
}).superRefine((v, ctx) => {
  if (v.smsOptIn && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "Add a mobile number to send text updates." });
  if (v.smsOptIn && !v.smsOptInSource) ctx.addIssue({ code: "custom", path: ["smsOptInSource"], message: "Note how they agreed to texts (e.g. \"Verbal, on site 10/14\")." });
});

export const billingProfileSchema = z.object({
  name: z.string().trim().min(2).max(200),
  billingEmail: email,
  billingPhone: phone,
  addressLine1: optStr(200),
  addressLine2: optStr(200),
  city: optStr(100),
  state: optStr(2),
  postalCode: optStr(10),
  paymentTermsDays: z.coerce.number().int().min(0).max(120),
  taxExempt: z.coerce.boolean().optional().default(false),
  taxRateBps: z.coerce.number().int().min(0).max(2500).optional().nullable(),
  allowPartialPayments: z.enum(["inherit", "yes", "no"]).optional().default("inherit"),
  poNumber: optStr(60),
  isDefault: z.coerce.boolean().optional().default(false),
});

export const assetSchema = z.object({
  type: z.enum(["GREASE_TRAP", "GREASE_INTERCEPTOR", "SEPTIC_TANK", "GRIT_TRAP", "LINT_TRAP", "LIFT_STATION", "OTHER"]),
  customTypeLabel: optStr(80),
  name: optStr(120),
  capacityGallons: z.coerce.number().int("Whole gallons only.").min(1, "Capacity must be at least 1 gallon.").max(100_000),
  placement: z.enum(["INDOOR", "OUTDOOR"]),
  installLocation: optStr(300),
  accessInstructions: optStr(4000),
  requiredEquipment: optStr(1000),
  frequencyDays: z.coerce.number().int().min(1).max(730).optional().nullable(),
  notes: optStr(4000),
});

// ── Organizations ────────────────────────────────────────────────────────────

export async function createOrganization(actor: Actor, input: z.infer<typeof organizationSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { ...input, accountNumber: await numbers.account(tx), createdById: actor.userId, updatedById: actor.userId },
    });
    await tx.billingProfile.create({
      data: { organizationId: org.id, name: `${org.name} — Billing`, billingEmail: input.primaryEmail, isDefault: true, paymentTermsDays: 30 },
    });
    await audit(tx, { actorId: actor.userId, action: "customer.create", entityType: "Organization", entityId: org.id, organizationId: org.id, after: input });
    return org;
  });
}

export async function updateOrganization(actor: Actor, id: string, input: z.infer<typeof organizationSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound();
    const org = await tx.organization.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
    const d = diff(before as unknown as Record<string, unknown>, input);
    if (d.changed) await audit(tx, { actorId: actor.userId, action: "customer.update", entityType: "Organization", entityId: id, organizationId: id, before: d.before, after: d.after });
    return org;
  });
}

export async function setOrganizationStatus(actor: Actor, id: string, active: boolean, reason: string) {
  assertStaffActor(actor, "customers.deactivate");
  if (!active && reason.trim().length < 3) throw badRequest("A reason is required to deactivate an account.");
  return prisma.$transaction(async (tx) => {
    const before = await tx.organization.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound();
    await tx.organization.update({ where: { id }, data: { status: active ? "ACTIVE" : "INACTIVE", updatedById: actor.userId } });
    if (!active) {
      // Pause recurring plans so no new jobs are generated for an inactive account.
      await tx.servicePlan.updateMany({ where: { organizationId: id, status: "ACTIVE" }, data: { status: "PAUSED" } });
    }
    await audit(tx, { actorId: actor.userId, action: active ? "customer.reactivate" : "customer.deactivate", entityType: "Organization", entityId: id, organizationId: id, before: { status: before.status }, after: { status: active ? "ACTIVE" : "INACTIVE" }, reason });
  });
}

export async function listOrganizations(params: { q?: string; status?: string; type?: string; page: number; pageSize?: number }) {
  const pageSize = params.pageSize ?? 25;
  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    ...(params.status === "ACTIVE" || params.status === "INACTIVE" ? { status: params.status } : {}),
    ...(params.type ? { type: params.type as Prisma.EnumOrganizationTypeFilter["equals"] } : {}),
    ...(params.q
      ? {
          OR: [
            { name: { contains: params.q, mode: "insensitive" } },
            { accountNumber: { contains: params.q, mode: "insensitive" } },
            { primaryPhone: { contains: params.q } },
            { primaryEmail: { contains: params.q, mode: "insensitive" } },
            { locations: { some: { OR: [{ name: { contains: params.q, mode: "insensitive" } }, { addressLine1: { contains: params.q, mode: "insensitive" } }] } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (params.page - 1) * pageSize,
      take: pageSize,
      include: {
        accountRep: { select: { name: true } },
        _count: { select: { locations: { where: { deletedAt: null } } } },
      },
    }),
    prisma.organization.count({ where }),
  ]);
  const balances = await prisma.invoice.groupBy({
    by: ["organizationId"],
    where: { organizationId: { in: items.map((i) => i.id) }, status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] } },
    _sum: { balanceCents: true },
  });
  const bal = new Map(balances.map((b) => [b.organizationId, b._sum.balanceCents ?? 0]));
  return { items: items.map((o) => ({ ...o, balanceCents: bal.get(o.id) ?? 0 })), total, pageSize };
}

// ── Locations ────────────────────────────────────────────────────────────────

export async function createLocation(actor: Actor, organizationId: string, input: z.infer<typeof locationSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
    if (!org) throw notFound("Organization not found.");
    if (input.billingProfileId) await assertBillingProfile(tx, organizationId, input.billingProfileId);
    const loc = await tx.serviceLocation.create({
      data: { ...input, organizationId, code: await numbers.location(tx), isDemo: org.isDemo, createdById: actor.userId, updatedById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "location.create", entityType: "ServiceLocation", entityId: loc.id, organizationId, after: input });
    return loc;
  });
}

async function assertBillingProfile(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const bp = await tx.billingProfile.findFirst({ where: { id, organizationId } });
  if (!bp) throw badRequest("Billing profile does not belong to this customer.");
}

export async function updateLocation(actor: Actor, id: string, input: z.infer<typeof locationSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.serviceLocation.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound();
    if (input.billingProfileId) await assertBillingProfile(tx, before.organizationId, input.billingProfileId);
    // A new address invalidates the old map position unless coordinates were edited too;
    // cleared coordinates are looked up again automatically from the address.
    const addressChanged = (["addressLine1", "city", "state", "postalCode"] as const).some((k) => before[k] !== input[k]);
    const coordsUntouched = (input.latitude ?? before.latitude) === before.latitude && (input.longitude ?? before.longitude) === before.longitude;
    const coords = addressChanged && coordsUntouched ? { latitude: null, longitude: null } : {};
    const loc = await tx.serviceLocation.update({ where: { id }, data: { ...input, ...coords, updatedById: actor.userId } });
    const d = diff(before as unknown as Record<string, unknown>, input);
    if (d.changed) await audit(tx, { actorId: actor.userId, action: "location.update", entityType: "ServiceLocation", entityId: id, organizationId: before.organizationId, before: d.before, after: d.after });
    return loc;
  });
}

export async function setLocationStatus(actor: Actor, id: string, active: boolean, reason: string) {
  assertStaffActor(actor, "customers.deactivate");
  return prisma.$transaction(async (tx) => {
    const loc = await tx.serviceLocation.findFirst({ where: { id, deletedAt: null } });
    if (!loc) throw notFound();
    await tx.serviceLocation.update({ where: { id }, data: { status: active ? "ACTIVE" : "INACTIVE", updatedById: actor.userId } });
    if (!active) await tx.servicePlan.updateMany({ where: { locationId: id, status: "ACTIVE" }, data: { status: "PAUSED" } });
    await audit(tx, { actorId: actor.userId, action: active ? "location.reactivate" : "location.deactivate", entityType: "ServiceLocation", entityId: id, organizationId: loc.organizationId, reason });
  });
}

// ── Contacts & billing profiles ──────────────────────────────────────────────

export async function upsertContact(actor: Actor, organizationId: string, contactId: string | null, input: z.infer<typeof contactSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    if (input.locationId && !(await tx.serviceLocation.count({ where: { id: input.locationId, organizationId } }))) throw badRequest("Location does not belong to this customer.");
    // Consent is recorded when texting is switched on; switching it on again after a STOP re-records it.
    const consent = (prev: { smsOptIn: boolean; smsOptedOutAt: Date | null; smsOptInAt: Date | null } | null) =>
      input.smsOptIn
        ? prev?.smsOptIn && !prev.smsOptedOutAt ? {} : { smsOptInAt: new Date(), smsOptedOutAt: null }
        : { smsOptInAt: null };
    if (contactId) {
      const existing = await tx.customerContact.findFirst({ where: { id: contactId, organizationId } });
      if (!existing) throw notFound();
      await tx.customerContact.update({ where: { id: contactId }, data: { ...input, ...consent(existing) } });
    } else {
      await tx.customerContact.create({ data: { ...input, ...consent(null), organizationId } });
    }
    await audit(tx, { actorId: actor.userId, action: contactId ? "contact.update" : "contact.create", entityType: "CustomerContact", entityId: contactId ?? "new", organizationId, after: input });
  });
}

export async function deleteContact(actor: Actor, organizationId: string, contactId: string) {
  assertStaffActor(actor, "customers.write");
  const c = await prisma.customerContact.findFirst({ where: { id: contactId, organizationId } });
  if (!c) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.customerContact.delete({ where: { id: contactId } });
    await audit(tx, { actorId: actor.userId, action: "contact.delete", entityType: "CustomerContact", entityId: contactId, organizationId, before: c });
  });
}

export async function upsertBillingProfile(actor: Actor, organizationId: string, profileId: string | null, input: z.infer<typeof billingProfileSchema>) {
  assertStaffActor(actor, ["customers.write", "invoices.write"]);
  const data = {
    ...input,
    allowPartialPayments: input.allowPartialPayments === "inherit" ? null : input.allowPartialPayments === "yes",
  };
  return prisma.$transaction(async (tx) => {
    if (input.isDefault) await tx.billingProfile.updateMany({ where: { organizationId }, data: { isDefault: false } });
    let id = profileId;
    if (profileId) {
      const existing = await tx.billingProfile.findFirst({ where: { id: profileId, organizationId } });
      if (!existing) throw notFound();
      await tx.billingProfile.update({ where: { id: profileId }, data });
    } else {
      id = (await tx.billingProfile.create({ data: { ...data, organizationId } })).id;
    }
    await audit(tx, { actorId: actor.userId, action: profileId ? "billing_profile.update" : "billing_profile.create", entityType: "BillingProfile", entityId: id!, organizationId, after: data });
  });
}

// ── Assets ───────────────────────────────────────────────────────────────────

export async function createAsset(actor: Actor, locationId: string, input: z.infer<typeof assetSchema>) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const loc = await tx.serviceLocation.findFirst({ where: { id: locationId, deletedAt: null } });
    if (!loc) throw notFound("Location not found.");
    const asset = await tx.serviceAsset.create({
      data: { ...input, organizationId: loc.organizationId, locationId, assetTag: await numbers.asset(tx), createdById: actor.userId, updatedById: actor.userId },
    });
    await audit(tx, { actorId: actor.userId, action: "asset.create", entityType: "ServiceAsset", entityId: asset.id, organizationId: loc.organizationId, after: input });
    return asset;
  });
}

export async function updateAsset(actor: Actor, id: string, input: z.infer<typeof assetSchema> & { status?: "ACTIVE" | "INACTIVE" }) {
  assertStaffActor(actor, "customers.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.serviceAsset.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound();
    const asset = await tx.serviceAsset.update({ where: { id }, data: { ...input, updatedById: actor.userId } });
    const d = diff(before as unknown as Record<string, unknown>, input);
    if (d.changed) await audit(tx, { actorId: actor.userId, action: "asset.update", entityType: "ServiceAsset", entityId: id, organizationId: before.organizationId, before: d.before, after: d.after });
    return asset;
  });
}

/** Chronological service history for one asset (newest first). */
export async function assetHistory(assetId: string, take = 50) {
  return prisma.serviceAssetRecord.findMany({
    where: { assetId, serviceRecord: { job: { status: { in: ["SUBMITTED", "COMPLETED"] } } } },
    orderBy: { serviceRecord: { finishedAt: "desc" } },
    take,
    include: { serviceRecord: { include: { job: { select: { id: true, jobNumber: true, scheduledDate: true, completedAt: true, status: true, manifest: { select: { id: true, manifestNumber: true, status: true } } } }, driver: { include: { user: { select: { name: true } } } } } } },
  });
}
