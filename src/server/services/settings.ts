import "server-only";
import { z } from "zod";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { DEFAULT_TIME_ZONE } from "@/lib/dates";

/**
 * Company settings are stored as one JSON value per key and validated on read and write.
 * Defaults are operational placeholders only; nothing here encodes a regulatory requirement.
 */
export const settingsSchemas = {
  company: z.object({
    name: z.string().min(1).default("Sewer Squad"),
    phone: z.string().default(""),
    email: z.string().default(""),
    addressLine1: z.string().default(""),
    city: z.string().default(""),
    state: z.string().default("TX"),
    postalCode: z.string().default(""),
    website: z.string().default(""),
    timeZone: z.string().default(DEFAULT_TIME_ZONE),
  }),
  emergency: z.object({
    phone: z.string().default(""),
    notice: z
      .string()
      .default(
        "Submitting a request online does not guarantee immediate dispatch. Our dispatch team will review your request and contact you to confirm timing and pricing. For an active overflow or safety hazard, call us directly.",
      ),
  }),
  hauler: z.object({
    legalName: z.string().default(""),
    transporterPermitNumber: z.string().default(""),
    registrationNumber: z.string().default(""),
    /** Printed on invoices, proposals and reports as "TCEQ #…". */
    tceqNumber: z.string().default(""),
    /** Printed as "City of Houston #…" once set. */
    cityOfHoustonNumber: z.string().default(""),
    /** First manifest/ticket number when continuing paper numbering (e.g. 194460). 0 = MF-YYYY-NNNNNN. */
    manifestStartNumber: z.number().int().min(0).max(99_999_999).default(0),
    certificationStatement: z
      .string()
      .default(
        "I certify that the waste described above was collected and transported by the named hauler. This statement is completed by the driver and verified by the office before finalization.",
      ),
  }),
  billing: z.object({
    defaultPaymentTermsDays: z.number().int().min(0).max(120).default(30),
    defaultTaxRateBps: z.number().int().min(0).max(2500).default(0),
    allowPartialPayments: z.boolean().default(true),
    lateFeeEnabled: z.boolean().default(false),
    lateFeeBps: z.number().int().min(0).max(2000).default(0),
    invoiceFooter: z.string().default("Thank you for your business."),
    /** Default closing line in the invoice NOTE. */
    invoiceNote: z.string().default("Payment due upon receipt. Thank you!"),
    /** Manifest fee as a share of the trap service, in basis points (400 = 4%). */
    manifestFeeBps: z.number().int().min(0).max(2500).default(400),
    /** Next service date printed on invoices when no recurring plan sets one. 0 = don't print. */
    nextServiceDays: z.number().int().min(0).max(730).default(90),
    reminderOffsetsDays: z.array(z.number().int()).default([-3, 0, 7, 14, 30]),
  }),
  scheduling: z.object({
    horizonDays: z.number().int().min(7).max(365).default(60),
    serviceReminderOffsetsDays: z.array(z.number().int().min(0)).default([14, 7, 1]),
    defaultWindowStart: z.string().default("08:00"),
    defaultWindowEnd: z.string().default("12:00"),
    serviceWindows: z
      .array(z.object({ label: z.string(), start: z.string(), end: z.string() }))
      .default([
        { label: "Early morning", start: "05:00", end: "08:00" },
        { label: "Morning", start: "08:00", end: "12:00" },
        { label: "Afternoon", start: "12:00", end: "16:00" },
        { label: "Evening", start: "16:00", end: "20:00" },
        { label: "Overnight", start: "22:00", end: "05:00" },
      ]),
  }),
  documents: z.object({
    retentionYears: z.number().int().min(1).max(50).default(5),
    maxUploadMb: z.number().int().min(1).max(100).default(20),
  }),
  customerAccess: z.object({
    readOnlyCanPay: z.boolean().default(false),
    showDriverNames: z.boolean().default(true),
    allowRescheduleRequests: z.boolean().default(true),
  }),
};

export type SettingsKey = keyof typeof settingsSchemas;
export type Settings<K extends SettingsKey> = z.infer<(typeof settingsSchemas)[K]>;

export async function getSetting<K extends SettingsKey>(key: K, db: Db = prisma): Promise<Settings<K>> {
  const row = await db.companySetting.findUnique({ where: { key } });
  const schema = settingsSchemas[key];
  const parsed = schema.safeParse(row?.value ?? {});
  if (parsed.success) return parsed.data as Settings<K>;
  // Stored value no longer matches the schema (e.g. after an upgrade): fall back to defaults
  // for invalid fields rather than failing the whole request.
  return schema.parse({}) as Settings<K>;
}

export async function getAllSettings(db: Db = prisma) {
  const keys = Object.keys(settingsSchemas) as SettingsKey[];
  const entries = await Promise.all(keys.map(async (k) => [k, await getSetting(k, db)] as const));
  return Object.fromEntries(entries) as { [K in SettingsKey]: Settings<K> };
}

export async function updateSetting<K extends SettingsKey>(key: K, value: unknown, actorId: string, db: Db = prisma) {
  const parsed = settingsSchemas[key].parse(value);
  const before = await db.companySetting.findUnique({ where: { key } });
  await db.companySetting.upsert({
    where: { key },
    create: { key, value: parsed as object, updatedById: actorId },
    update: { value: parsed as object, updatedById: actorId },
  });
  await audit(db, {
    actorId,
    action: "settings.update",
    entityType: "CompanySetting",
    entityId: key,
    before: before?.value ?? null,
    after: parsed,
  });
  return parsed as Settings<K>;
}

export async function companyTimeZone(db: Db = prisma): Promise<string> {
  return (await getSetting("company", db)).timeZone || DEFAULT_TIME_ZONE;
}
