import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { dateFromKey, isDateKey } from "@/lib/dates";
import { storeDocument } from "./documents";

const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));
export const reportSectionSchema = z.object({ title: z.string().trim().min(1, "Give each section a heading.").max(120), body: z.string().trim().min(1, "Write something in each section, or remove it.").max(8000) });
export type ReportSection = z.infer<typeof reportSectionSchema>;

export const reportSchema = z.object({
  organizationId: optUuid,
  locationId: optUuid,
  jobId: optUuid,
  invoiceId: optUuid,
  preparedFor: z.string().trim().min(2, "Who is this for?").max(200),
  addressLine1: z.string().trim().min(3, "Enter the address.").max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().max(10),
  serviceDate: z.string().refine(isDateKey, "Enter a valid date."),
  subject: z.string().trim().min(2, "Enter a subject.").max(160),
  closing: z.string().trim().max(1000).optional(),
  sections: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid sections." });
        return z.NEVER;
      }
    })
    .pipe(z.array(reportSectionSchema).min(1, "Add at least one section.").max(12)),
});
export type ReportInput = z.infer<typeof reportSchema>;

export function reportSections(json: Prisma.JsonValue): ReportSection[] {
  const parsed = z.array(reportSectionSchema).safeParse(json);
  return parsed.success ? parsed.data : [];
}

async function links(db: Db, input: ReportInput) {
  const job = input.jobId ? await db.job.findUnique({ where: { id: input.jobId } }) : null;
  if (input.jobId && !job) throw badRequest("Job not found.");
  const invoice = input.invoiceId ? await db.invoice.findUnique({ where: { id: input.invoiceId } }) : null;
  if (input.invoiceId && !invoice) throw badRequest("Invoice not found.");
  const organizationId = input.organizationId ?? job?.organizationId ?? invoice?.organizationId ?? null;
  const locationId = input.locationId ?? job?.locationId ?? invoice?.serviceLocationId ?? null;
  if (locationId && organizationId && !(await db.serviceLocation.findFirst({ where: { id: locationId, organizationId } }))) throw badRequest("Location does not belong to this customer.");
  return { organizationId, locationId, jobId: job?.id ?? null, invoiceId: invoice?.id ?? null, invoice };
}

const data = (input: ReportInput) => ({
  preparedFor: input.preparedFor,
  addressLine1: input.addressLine1,
  city: input.city,
  state: input.state,
  postalCode: input.postalCode,
  serviceDate: dateFromKey(input.serviceDate),
  subject: input.subject,
  closing: input.closing || null,
  sections: input.sections as unknown as Prisma.InputJsonValue,
});

/** Reports for an invoiced visit share the invoice's number, as on the owner's paperwork. */
async function reportNumber(db: Db, invoiceNumber: string | null) {
  if (invoiceNumber && !(await db.serviceReport.findUnique({ where: { number: invoiceNumber } }))) return invoiceNumber;
  return numbers.report(db);
}

export async function createReport(actor: Actor, input: ReportInput) {
  assertStaffActor(actor, "jobs.write");
  return prisma.$transaction(async (tx) => {
    const l = await links(tx, input);
    const r = await tx.serviceReport.create({ data: { ...data(input), organizationId: l.organizationId, locationId: l.locationId, jobId: l.jobId, invoiceId: l.invoiceId, number: await reportNumber(tx, l.invoice?.invoiceNumber ?? null), createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "report.create", entityType: "ServiceReport", entityId: r.id, organizationId: l.organizationId, after: input });
    return r;
  });
}

export async function updateReport(actor: Actor, id: string, input: ReportInput) {
  assertStaffActor(actor, "jobs.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.serviceReport.findUnique({ where: { id } });
    if (!before) throw notFound();
    const l = await links(tx, input);
    const r = await tx.serviceReport.update({ where: { id }, data: { ...data(input), organizationId: l.organizationId, locationId: l.locationId, jobId: l.jobId, invoiceId: l.invoiceId } });
    if (before.status === "FINAL") await storeReportPdf(tx, id, actor.userId);
    await audit(tx, { actorId: actor.userId, action: "report.update", entityType: "ServiceReport", entityId: id, organizationId: l.organizationId, after: input });
    return r;
  });
}

/** Final reports are filed as a PDF the customer can see in their portal. */
export async function finalizeReport(actor: Actor, id: string) {
  assertStaffActor(actor, "jobs.write");
  return prisma.$transaction(async (tx) => {
    const r = await tx.serviceReport.findUnique({ where: { id } });
    if (!r) throw notFound();
    const saved = await tx.serviceReport.update({ where: { id }, data: { status: "FINAL", finalizedAt: r.finalizedAt ?? new Date() } });
    await storeReportPdf(tx, id, actor.userId);
    await audit(tx, { actorId: actor.userId, action: "report.finalize", entityType: "ServiceReport", entityId: id, organizationId: r.organizationId });
    return saved;
  });
}

export async function storeReportPdf(db: Db, reportId: string, actorId: string | null) {
  const { renderReportPdf } = await import("../pdf/report-pdf");
  const r = await db.serviceReport.findUniqueOrThrow({ where: { id: reportId } });
  const bytes = await renderReportPdf(db, reportId);
  await db.document.updateMany({ where: { serviceReportId: reportId, type: "SERVICE_REPORT", deletedAt: null }, data: { visibility: "INTERNAL", deletedAt: new Date() } });
  return storeDocument(db, {
    bytes,
    fileName: `Service Report ${r.number}.pdf`,
    title: `Service report ${r.number} — ${r.subject}`,
    type: "SERVICE_REPORT",
    visibility: r.organizationId ? "CUSTOMER" : "INTERNAL",
    organizationId: r.organizationId,
    locationId: r.locationId,
    jobId: r.jobId,
    serviceReportId: r.id,
    uploadedById: actorId,
    trusted: { mime: "application/pdf", ext: "pdf" },
  });
}

/** Standard warranty paragraph from the owner's reports. */
export const STANDARD_WARRANTY =
  "All of our work is backed by a 90-day warranty. If the same issue returns within 90 days of service, we will make it right. We use commercial-grade equipment, dispose of all waste in full compliance with TCEQ and City of Houston regulations, and stand behind every job we complete.";
