import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { isDateKey } from "@/lib/dates";
import { parseDollarRateToCentsString, parseDollarsToCents } from "@/lib/money";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { createJob } from "./jobs";
import { createPlan } from "./plans";
import { disambiguateLocationNames } from "./location-names";

/**
 * "New Customer": the customer, their contact, every location and its first service, in one
 * step. Recurring service creates a plan (and its first visit); one-time and emergency create a job.
 */
const s = (max: number) => z.string().trim().max(max);
const opt = (max: number) => s(max).optional().transform((v) => (v ? v : null));
const phone = s(40).regex(/^[\d+().\-\s x]*$/, "Use digits and + ( ) - only.").optional().transform((v) => (v ? v : null));
const email = z.string().trim().toLowerCase().email("Enter a valid email.").optional().or(z.literal("").transform(() => undefined)).transform((v) => v ?? null);

const SERVICE_TYPES = ["GREASE_TRAP_PUMPING", "INTERCEPTOR_PUMPING", "SEPTIC_PUMPING", "GRIT_TRAP_CLEANING", "LINT_TRAP_CLEANING", "LIFT_STATION_SERVICE", "HYDRO_JETTING", "LINE_CLEANING", "INSPECTION", "OTHER"] as const;

export const newLocationSchema = z
  .object({
    name: opt(200),
    addressLine1: s(200).min(3, "Address is required."),
    city: s(100).min(2, "City is required."),
    state: s(2).length(2, "2-letter state").toUpperCase().default("TX"),
    postalCode: s(10).regex(/^\d{5}(-\d{4})?$/, "Enter a valid ZIP code."),
    siteContactName: opt(200),
    siteContactPhone: phone,
    accessInstructions: opt(2000),
    manifestFee: z.enum(["NONE", "STANDARD", "CITY_OF_HOUSTON", "WAIVED"]).default("NONE"),
    trapType: z.enum(["GREASE_TRAP", "GREASE_INTERCEPTOR", "GRIT_TRAP", "SEPTIC_TANK", "LINT_TRAP", "LIFT_STATION", "OTHER"]).default("GREASE_TRAP"),
    trapGallons: z.coerce.number().int("Whole gallons only.").min(0).max(100_000).optional(),
    jobType: z.enum(["RECURRING", "ONE_TIME", "EMERGENCY"]).default("RECURRING"),
    serviceType: z.enum(SERVICE_TYPES).default("GREASE_TRAP_PUMPING"),
    date: z.string().refine(isDateKey, "Pick a service date."),
    intervalDays: z.coerce.number().int().min(7, "At least 7 days.").max(730).default(90),
    pricingModel: z.enum(["PER_GALLON", "FLAT_RATE"]).default("PER_GALLON"),
    price: opt(20),
    notes: opt(2000),
  })
  .superRefine((v, ctx) => {
    if (v.price && (v.pricingModel === "PER_GALLON" ? parseDollarRateToCentsString(v.price) === null : parseDollarsToCents(v.price) === null)) {
      ctx.addIssue({ code: "custom", path: ["price"], message: v.pricingModel === "PER_GALLON" ? "Enter a rate such as 0.89" : "Enter a dollar amount." });
    }
  });

export const newCustomerSchema = z
  .object({
    name: s(200).min(2, "Business name is required."),
    type: z.enum(["RESTAURANT_GROUP", "RESTAURANT", "HOTEL", "HOSPITAL", "SCHOOL", "GROCERY", "INSTITUTIONAL", "OTHER"]).default("RESTAURANT"),
    contactName: s(200).min(2, "Contact name is required."),
    contactTitle: opt(120),
    email,
    phone,
    smsOptIn: z.boolean().default(false),
    smsOptInSource: opt(200),
    notes: opt(4000),
    multiUnit: z.boolean().default(false),
    leadId: z.string().uuid().optional(),
    locations: z.array(newLocationSchema).min(1).max(25),
  })
  .superRefine((v, ctx) => {
    if (v.smsOptIn && !v.phone) ctx.addIssue({ code: "custom", path: ["phone"], message: "Add a mobile number to send text updates." });
    if (v.smsOptIn && !v.smsOptInSource) ctx.addIssue({ code: "custom", path: ["smsOptInSource"], message: "Note how they agreed to texts." });
    if (v.multiUnit) v.locations.forEach((l, i) => !l.name && ctx.addIssue({ code: "custom", path: ["locations", i, "name"], message: "Name each location (e.g. “Westheimer”)." }));
  });

export type NewCustomerInput = z.infer<typeof newCustomerSchema>;

export async function createCustomerWithService(actor: Actor, input: NewCustomerInput) {
  assertStaffActor(actor, "customers.write");
  assertStaffActor(actor, "jobs.write");
  const locations = input.multiUnit ? input.locations : input.locations.slice(0, 1);
  return prisma.$transaction(
    async (tx) => {
      const dupe = await tx.organization.findFirst({ where: { deletedAt: null, name: { equals: input.name, mode: "insensitive" } }, select: { id: true } });
      if (dupe) throw badRequest(`A customer named “${input.name}” already exists. Open it from Customers to add a location or schedule service.`);
      const org = await tx.organization.create({
        data: { name: input.name, type: input.type, billingMode: "CONSOLIDATED", primaryEmail: input.email, primaryPhone: input.phone, notes: input.notes, accountNumber: await numbers.account(tx), createdById: actor.userId, updatedById: actor.userId },
      });
      await tx.billingProfile.create({ data: { organizationId: org.id, name: `${org.name} — Billing`, billingEmail: input.email, billingPhone: input.phone, isDefault: true, paymentTermsDays: 30 } });
      await tx.customerContact.create({
        data: {
          organizationId: org.id,
          name: input.contactName,
          title: input.contactTitle,
          email: input.email,
          phone: input.phone,
          isPrimary: true,
          receivesInvoices: true,
          receivesReminders: true,
          smsOptIn: input.smsOptIn,
          smsOptInSource: input.smsOptIn ? input.smsOptInSource : null,
          smsOptInAt: input.smsOptIn ? new Date() : null,
        },
      });

      const scheduled: { location: string; jobType: string; date: string }[] = [];
      for (const l of locations) {
        const name = l.name ?? input.name;
        const loc = await tx.serviceLocation.create({
          data: {
            organizationId: org.id,
            code: await numbers.location(tx),
            name: input.multiUnit && l.name && !l.name.toLowerCase().includes(input.name.toLowerCase()) ? `${input.name} — ${l.name}` : name,
            addressLine1: l.addressLine1,
            city: l.city,
            state: l.state,
            postalCode: l.postalCode,
            siteContactName: l.siteContactName ?? (locations.length === 1 ? input.contactName : null),
            siteContactPhone: l.siteContactPhone ?? (locations.length === 1 ? input.phone : null),
            accessInstructions: l.accessInstructions,
            manifestFee: l.manifestFee,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
        const grit = l.trapType === "GRIT_TRAP";
        const asset = await tx.serviceAsset.create({
          data: { assetTag: await numbers.asset(tx), organizationId: org.id, locationId: loc.id, type: l.trapType, name: grit ? "Grit trap" : l.trapType === "GREASE_INTERCEPTOR" ? "Grease interceptor" : l.trapType === "GREASE_TRAP" ? "Grease trap" : null, capacityGallons: l.trapGallons ?? 0, placement: "OUTDOOR", frequencyDays: l.jobType === "RECURRING" ? l.intervalDays : null, createdById: actor.userId, updatedById: actor.userId },
        });
        const label = SERVICE_TYPE_LABEL[l.serviceType] ?? "Service";
        if (l.jobType === "RECURRING") {
          await createPlan(
            actor,
            {
              locationId: loc.id,
              name: `${label} — every ${l.intervalDays} days`,
              serviceType: l.serviceType,
              assetIds: [asset.id],
              unit: "DAY",
              interval: l.intervalDays,
              anchor: "COMPLETION_DATE",
              startDate: l.date,
              preferredWindowStart: null,
              preferredWindowEnd: null,
              pricingModel: l.pricingModel,
              flatPrice: l.pricingModel === "FLAT_RATE" ? l.price ?? undefined : undefined,
              perGallonPrice: l.pricingModel === "PER_GALLON" ? l.price ?? undefined : undefined,
              specialInstructions: l.notes ?? undefined,
            },
            { db: tx },
          );
        } else {
          if (l.price && l.pricingModel === "PER_GALLON") {
            await tx.pricingRule.create({ data: { organizationId: org.id, name: `${label} rate`, kind: "PER_GALLON", serviceType: l.serviceType, amountCents: new Prisma.Decimal(parseDollarRateToCentsString(l.price)!) } });
          }
          await createJob(
            actor,
            {
              locationId: loc.id,
              serviceType: l.serviceType,
              type: l.jobType,
              priority: l.jobType === "EMERGENCY" ? "EMERGENCY" : "NORMAL",
              scheduledDate: l.date,
              windowStart: null,
              windowEnd: null,
              assetIds: [asset.id],
              estimatedGallons: l.trapGallons || null,
              instructions: l.notes ?? undefined,
              quotedPrice: l.price && l.pricingModel === "FLAT_RATE" ? l.price : undefined,
            },
            { db: tx },
          );
        }
        scheduled.push({ location: loc.name, jobType: l.jobType, date: l.date });
      }
      if (input.leadId) {
        const lead = await tx.lead.findUnique({ where: { id: input.leadId } });
        if (lead) {
          await tx.lead.update({ where: { id: lead.id }, data: { status: "WON", organizationId: org.id, ...(lead.firstContactedAt ? {} : { firstContactedAt: new Date(), firstContactedById: actor.userId, firstContactMethod: "other" }) } });
          await tx.leadActivity.create({ data: { leadId: lead.id, kind: "status", body: `Became a customer: ${org.name}`, actorId: actor.userId } });
        }
      }
      await disambiguateLocationNames(tx);
      await audit(tx, { actorId: actor.userId, action: "customer.onboard", entityType: "Organization", entityId: org.id, organizationId: org.id, after: { ...input, locations } });
      return { organizationId: org.id, scheduled };
    },
    { timeout: 30_000 },
  );
}
