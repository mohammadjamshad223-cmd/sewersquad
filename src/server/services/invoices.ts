import "server-only";
import { z } from "zod";
import { Prisma, type LineItemKind, type Invoice } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { computeInvoiceTotals, deriveInvoiceStatus, lineAmountCents, type InvoiceStatus } from "@/domain/invoice-math";
import { addDays, dateFromKey, formatDateKey, isDateKey, keyFromDate, todayKey } from "@/lib/dates";
import { formatCents, parseDollarRateToCentsString } from "@/lib/money";
import { LINE_ITEM_KIND_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { companyTimeZone, getSetting } from "./settings";
import { manifestFeeCents } from "@/domain/document-lines";
import { notify, staffWithPermission } from "./notifications";
import { storeDocument } from "./documents";

const LINE_KINDS = ["SERVICE", "PER_GALLON", "FLAT_RATE", "MINIMUM_CHARGE", "EMERGENCY_SURCHARGE", "AFTER_HOURS", "ADDITIONAL_EQUIPMENT", "DISPOSAL_FEE", "MANIFEST_FEE", "DISCOUNT", "LATE_FEE", "OTHER"] as const;

export const lineSchema = z.object({
  kind: z.enum(LINE_KINDS),
  description: z.string().trim().min(1, "Description required").max(300),
  quantity: z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Quantity up to 3 decimals"),
  unitPrice: z.string().trim().refine((v) => parseDollarRateToCentsString(v) !== null, "Enter a price such as 125.00 or 0.35"),
  taxable: z.coerce.boolean().optional().default(true),
});

export const invoiceSchema = z.object({
  organizationId: z.string().uuid(),
  serviceLocationId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  billingProfileId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  serviceDate: z.string().refine(isDateKey).optional().or(z.literal("").transform(() => undefined)),
  paymentTermsDays: z.coerce.number().int().min(0).max(120).optional(),
  poNumber: z.string().trim().max(60).optional(),
  serviceTitle: z.string().trim().max(120).optional(),
  nextServiceDate: z.string().refine(isDateKey).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  lines: z.array(lineSchema).min(1, "Add at least one line item."),
});

/** Invoice headline for a service type, as on the owner's invoices ("Grease Trap Pumping & Disposal"). */
export const SERVICE_TITLE: Record<string, string> = {
  GREASE_TRAP_PUMPING: "Grease Trap Pumping & Disposal",
  INTERCEPTOR_PUMPING: "Grease Interceptor Pumping & Disposal",
  SEPTIC_PUMPING: "Septic Pumping & Disposal",
  GRIT_TRAP_CLEANING: "Grit Trap Pumping & Disposal",
  LINT_TRAP_CLEANING: "Lint Trap Pumping & Disposal",
  LIFT_STATION_SERVICE: "Lift Station Service",
  HYDRO_JETTING: "Hydro Jetting",
  LINE_CLEANING: "Line Cleaning",
  INSPECTION: "Inspection",
  OTHER: "Service",
};
const sentenceCase = (t: string) => t.charAt(0) + t.slice(1).toLowerCase();

/** Manifest fee line for a location's fee type, or null. Amount = bps of the trap service lines. */
export function manifestFeeLine(feeType: string | null | undefined, lines: { kind: string; quantity: string; unitPriceCents: string }[], bps: number): LineDraft | null {
  if (feeType !== "STANDARD" && feeType !== "CITY_OF_HOUSTON") return null;
  const cents = manifestFeeCents(lines.map((l) => ({ kind: l.kind, amountCents: lineAmountCents(l.quantity, l.unitPriceCents) })), bps);
  if (cents <= 0) return null;
  return { kind: "MANIFEST_FEE", description: feeType === "CITY_OF_HOUSTON" ? "City of Houston manifest fee" : "Manifest fee", quantity: "1", unitPriceCents: String(cents), taxable: false };
}

type LineDraft = { kind: LineItemKind; description: string; quantity: string; unitPriceCents: string; taxable: boolean };

async function resolveBilling(db: Db, organizationId: string, locationId: string | null, billingProfileId?: string | null) {
  const org = await db.organization.findFirst({ where: { id: organizationId, deletedAt: null } });
  if (!org) throw notFound("Customer not found.");
  const loc = locationId ? await db.serviceLocation.findFirst({ where: { id: locationId, organizationId } }) : null;
  if (locationId && !loc) throw badRequest("Location does not belong to this customer.");
  const profile =
    (billingProfileId && (await db.billingProfile.findFirst({ where: { id: billingProfileId, organizationId } }))) ||
    (loc?.billingProfileId && (await db.billingProfile.findUnique({ where: { id: loc.billingProfileId } }))) ||
    (await db.billingProfile.findFirst({ where: { organizationId, isDefault: true } })) ||
    (await db.billingProfile.findFirst({ where: { organizationId } }));
  const billing = await getSetting("billing", db);
  return {
    org,
    loc,
    profile,
    termsDays: profile?.paymentTermsDays ?? billing.defaultPaymentTermsDays,
    taxRateBps: profile?.taxExempt ? 0 : profile?.taxRateBps ?? billing.defaultTaxRateBps,
    allowPartial: profile?.allowPartialPayments ?? billing.allowPartialPayments,
    billingLocationId: org.billingMode === "PER_LOCATION" && loc ? loc.id : null,
  };
}

async function writeLines(db: Db, invoiceId: string, lines: LineDraft[], taxRateBps: number) {
  const totals = computeInvoiceTotals(lines.map((l) => ({ kind: l.kind, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: l.taxable })), taxRateBps);
  await db.invoiceLineItem.deleteMany({ where: { invoiceId } });
  await db.invoiceLineItem.createMany({
    data: lines.map((l, i) => ({
      invoiceId,
      kind: l.kind,
      description: l.description,
      quantity: new Prisma.Decimal(l.quantity),
      unitPriceCents: new Prisma.Decimal(l.unitPriceCents),
      amountCents: totals.lines[i]!.amountCents,
      taxable: l.taxable,
      sortOrder: i,
    })),
  });
  return totals;
}

/** Manifest fee lines are always recomputed from the trap service lines, whatever was typed. */
function linesFromInput(input: z.infer<typeof invoiceSchema>["lines"], manifestFeeBps: number): LineDraft[] {
  const lines: LineDraft[] = input.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity, unitPriceCents: parseDollarRateToCentsString(l.unitPrice)!, taxable: l.kind === "DISCOUNT" ? true : l.taxable }));
  const fee = manifestFeeCents(lines.map((l) => ({ kind: l.kind, amountCents: lineAmountCents(l.quantity, l.unitPriceCents) })), manifestFeeBps);
  return lines.map((l) => (l.kind === "MANIFEST_FEE" ? { ...l, quantity: "1", unitPriceCents: String(fee), taxable: false } : l));
}

export async function createInvoice(actor: Actor, input: z.infer<typeof invoiceSchema>) {
  assertStaffActor(actor, "invoices.write");
  const tz = await companyTimeZone();
  return prisma.$transaction(async (tx) => {
    const b = await resolveBilling(tx, input.organizationId, input.serviceLocationId ?? null, input.billingProfileId);
    const issue = todayKey(tz);
    const terms = input.paymentTermsDays ?? b.termsDays;
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: await numbers.invoice(tx),
        organizationId: b.org.id,
        billingProfileId: b.profile?.id ?? null,
        billingLocationId: b.billingLocationId,
        serviceLocationId: input.serviceLocationId ?? null,
        serviceDate: input.serviceDate ? dateFromKey(input.serviceDate) : null,
        issueDate: dateFromKey(issue),
        dueDate: dateFromKey(addDays(issue, terms)),
        paymentTermsDays: terms,
        subtotalCents: 0,
        totalCents: 0,
        balanceCents: 0,
        taxRateBps: b.taxRateBps,
        allowPartial: b.allowPartial,
        poNumber: input.poNumber ?? b.profile?.poNumber ?? null,
        serviceTitle: input.serviceTitle ?? null,
        nextServiceDate: input.nextServiceDate ? dateFromKey(input.nextServiceDate) : null,
        notes: input.notes ?? null,
        isDemo: b.org.isDemo,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    const t = await writeLines(tx, invoice.id, linesFromInput(input.lines, (await getSetting("billing", tx)).manifestFeeBps), b.taxRateBps);
    const saved = await tx.invoice.update({ where: { id: invoice.id }, data: { subtotalCents: t.subtotalCents, discountCents: t.discountCents, taxCents: t.taxCents, totalCents: t.totalCents, balanceCents: t.totalCents } });
    await audit(tx, { actorId: actor.userId, action: "invoice.create", entityType: "Invoice", entityId: invoice.id, organizationId: b.org.id, after: { ...input, totals: t } });
    return saved;
  });
}

export async function updateDraftInvoice(actor: Actor, invoiceId: string, input: z.infer<typeof invoiceSchema>, reason?: string) {
  assertStaffActor(actor, "invoices.write");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } });
    if (!inv) throw notFound();
    if (inv.status !== "DRAFT") throw badRequest("Only draft invoices can be edited. Void and reissue a sent invoice instead.");
    if (inv.organizationId !== input.organizationId) throw badRequest("The customer on an invoice cannot be changed.");
    const t = await writeLines(tx, inv.id, linesFromInput(input.lines, (await getSetting("billing", tx)).manifestFeeBps), inv.taxRateBps);
    const terms = input.paymentTermsDays ?? inv.paymentTermsDays;
    await tx.invoice.update({
      where: { id: inv.id },
      data: {
        serviceLocationId: input.serviceLocationId ?? inv.serviceLocationId,
        serviceDate: input.serviceDate ? dateFromKey(input.serviceDate) : inv.serviceDate,
        paymentTermsDays: terms,
        dueDate: dateFromKey(addDays(keyFromDate(inv.issueDate), terms)),
        poNumber: input.poNumber ?? inv.poNumber,
        serviceTitle: input.serviceTitle ?? null,
        nextServiceDate: input.nextServiceDate ? dateFromKey(input.nextServiceDate) : null,
        notes: input.notes ?? null,
        subtotalCents: t.subtotalCents,
        discountCents: t.discountCents,
        taxCents: t.taxCents,
        totalCents: t.totalCents,
        balanceCents: t.totalCents,
        updatedById: actor.userId,
      },
    });
    await audit(tx, {
      actorId: actor.userId,
      action: "invoice.update",
      entityType: "Invoice",
      entityId: inv.id,
      organizationId: inv.organizationId,
      before: { totalCents: inv.totalCents, lines: inv.lineItems.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPriceCents: l.unitPriceCents.toString() })) },
      after: { totalCents: t.totalCents, lines: input.lines },
      reason: reason ?? null,
    });
  });
}

/**
 * Pricing resolution for a completed job (first match wins for the base charge):
 *   1. quoted price confirmed by dispatch (emergency / one-time)
 *   2. the service plan's contracted price (flat or per gallon, with minimum)
 *   3. customer-specific pricing rule for the service type
 *   4. company default pricing rule for the service type
 * When nothing matches, a zero-priced "pricing required" line is added and the invoice is kept
 * as a DRAFT for the office — prices are never invented.
 */
export async function buildJobLines(db: Db, jobId: string): Promise<{ lines: LineDraft[]; needsPricing: boolean; gallons: number }> {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: { plan: true, location: true, charges: { where: { status: "APPROVED" } }, serviceRecord: { include: { assetRecords: true } } },
  });
  const gallons = job.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0;
  const label = sentenceCase(SERVICE_TITLE[job.serviceType] ?? SERVICE_TYPE_LABEL[job.serviceType] ?? "Service");
  const lines: LineDraft[] = [];
  let needsPricing = false;

  const rules = await db.pricingRule.findMany({
    where: { active: true, OR: [{ organizationId: job.organizationId }, { organizationId: null }], AND: [{ OR: [{ serviceType: job.serviceType }, { serviceType: null }] }] },
    orderBy: [{ organizationId: { sort: "desc", nulls: "last" } }, { serviceType: { sort: "desc", nulls: "last" } }],
  });
  const pick = (kind: LineItemKind) => rules.find((r) => r.kind === kind);

  const pushBase = (kind: LineItemKind, description: string, quantity: string, unit: string) => lines.push({ kind, description, quantity, unitPriceCents: unit, taxable: true });
  const applyMinimum = (minCents: number | null | undefined) => {
    if (!minCents) return;
    const base = lines.reduce((s, l) => s + lineAmountCents(l.quantity, l.unitPriceCents), 0);
    if (base < minCents) {
      const diff = minCents - base;
      lines.push({ kind: "MINIMUM_CHARGE", description: `Minimum service charge adjustment (minimum ${formatCents(minCents)})`, quantity: "1", unitPriceCents: String(diff), taxable: true });
    }
  };

  if (job.quotedPriceCents !== null && job.quotedPriceCents !== undefined) {
    pushBase("SERVICE", label, "1", String(job.quotedPriceCents));
  } else if (job.plan && (job.plan.flatPriceCents !== null || job.plan.perGallonCents !== null)) {
    if (job.plan.pricingModel === "FLAT_RATE" && job.plan.flatPriceCents !== null) {
      pushBase("FLAT_RATE", label, "1", String(job.plan.flatPriceCents));
    } else if (job.plan.perGallonCents !== null) {
      pushBase("PER_GALLON", label, String(gallons), job.plan.perGallonCents.toString());
      applyMinimum(job.plan.minimumChargeCents);
    } else needsPricing = true;
  } else {
    const perGallon = pick("PER_GALLON");
    const flat = pick("FLAT_RATE");
    if (perGallon && (!flat || (perGallon.organizationId && !flat.organizationId))) {
      pushBase("PER_GALLON", label, String(gallons), perGallon.amountCents.toString());
      const min = pick("MINIMUM_CHARGE");
      applyMinimum(min ? Number(min.amountCents) : null);
    } else if (flat) {
      pushBase("FLAT_RATE", label, "1", flat.amountCents.toString());
    } else {
      needsPricing = true;
    }
  }
  if (needsPricing) lines.push({ kind: "SERVICE", description: `${label} — PRICING REQUIRED`, quantity: "1", unitPriceCents: "0", taxable: true });

  if (job.type === "EMERGENCY" && job.quotedPriceCents === null) {
    const s = pick("EMERGENCY_SURCHARGE");
    if (s) {
      if (s.percentBps) {
        const base = lines.reduce((sum, l) => sum + lineAmountCents(l.quantity, l.unitPriceCents), 0);
        lines.push({ kind: "EMERGENCY_SURCHARGE", description: `Emergency service surcharge (${s.percentBps / 100}%)`, quantity: "1", unitPriceCents: String(Math.round((base * s.percentBps) / 10_000)), taxable: true });
      } else {
        lines.push({ kind: "EMERGENCY_SURCHARGE", description: "Emergency service surcharge", quantity: "1", unitPriceCents: s.amountCents.toString(), taxable: true });
      }
    }
  }
  const fee = manifestFeeLine(job.location.manifestFee, lines, (await getSetting("billing", db)).manifestFeeBps);
  if (fee) lines.push(fee);
  const disposalRule = pick("DISPOSAL_FEE");
  if (disposalRule && gallons > 0) lines.push({ kind: "DISPOSAL_FEE", description: `Disposal fee — ${gallons.toLocaleString()} gal`, quantity: String(gallons), unitPriceCents: disposalRule.amountCents.toString(), taxable: false });

  for (const c of job.charges) {
    lines.push({ kind: c.kind, description: c.description, quantity: c.quantity.toString(), unitPriceCents: c.unitPriceCents.toString(), taxable: true });
  }
  return { lines, needsPricing, gallons };
}

/** Idempotent: a job has at most one invoice (unique jobId). Returns the existing one if present. */
export async function generateInvoiceForJob(actor: Actor, jobId: string, opts: { db?: Db; send?: boolean } = {}) {
  assertStaffActor(actor, ["invoices.write", "jobs.approve"]);
  const run = async (tx: Db) => {
    const existing = await tx.invoice.findUnique({ where: { jobId } });
    if (existing) return existing;
    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId }, include: { manifest: true, plan: { select: { nextServiceDate: true, status: true } } } });
    if (job.status !== "COMPLETED") throw badRequest("Invoices are generated from approved (completed) jobs.");
    const b = await resolveBilling(tx, job.organizationId, job.locationId);
    const { lines, needsPricing } = await buildJobLines(tx, jobId);
    const tz = await companyTimeZone(tx);
    const issue = todayKey(tz);
    const invoice = await tx.invoice.create({
      data: {
        invoiceNumber: await numbers.invoice(tx),
        organizationId: job.organizationId,
        billingProfileId: b.profile?.id ?? null,
        billingLocationId: b.billingLocationId,
        serviceLocationId: job.locationId,
        jobId,
        manifestId: job.manifest?.id ?? null,
        serviceDate: job.scheduledDate,
        serviceTitle: SERVICE_TITLE[job.serviceType] ?? null,
        nextServiceDate: await nextServiceDateFor(tx, job),
        issueDate: dateFromKey(issue),
        dueDate: dateFromKey(addDays(issue, b.termsDays)),
        paymentTermsDays: b.termsDays,
        subtotalCents: 0,
        totalCents: 0,
        balanceCents: 0,
        taxRateBps: b.taxRateBps,
        allowPartial: b.allowPartial,
        poNumber: b.profile?.poNumber ?? null,
        notes: needsPricing ? "Pricing required: no contracted or default price was found for this service." : null,
        isDemo: job.isDemo,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    const t = await writeLines(tx, invoice.id, lines, b.taxRateBps);
    const saved = await tx.invoice.update({ where: { id: invoice.id }, data: { subtotalCents: t.subtotalCents, discountCents: t.discountCents, taxCents: t.taxCents, totalCents: t.totalCents, balanceCents: t.totalCents } });
    await audit(tx, { actorId: actor.userId, action: "invoice.generate_from_job", entityType: "Invoice", entityId: invoice.id, organizationId: job.organizationId, after: { jobId, totals: t, needsPricing } });
    if (opts.send && !needsPricing && t.totalCents > 0) return sendInvoice(actor, invoice.id, { db: tx });
    return saved;
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run, { timeout: 30_000 });
}

/** The plan's next visit when there is one, else the service date + the configured interval. */
async function nextServiceDateFor(db: Db, job: { scheduledDate: Date; plan: { nextServiceDate: Date | null; status: string } | null }) {
  if (job.plan?.status === "ACTIVE" && job.plan.nextServiceDate && job.plan.nextServiceDate > job.scheduledDate) return job.plan.nextServiceDate;
  const days = (await getSetting("billing", db)).nextServiceDays;
  return days > 0 ? dateFromKey(addDays(keyFromDate(job.scheduledDate), days)) : null;
}

async function invoiceRecipients(db: Db, inv: Pick<Invoice, "organizationId" | "serviceLocationId" | "billingLocationId">) {
  const { customerRecipientsForLocation } = await import("./notifications");
  return customerRecipientsForLocation(db, inv.organizationId, inv.serviceLocationId ?? inv.billingLocationId);
}

export async function sendInvoice(actor: Actor, invoiceId: string, opts: { db?: Db } = {}) {
  assertStaffActor(actor, ["invoices.write", "jobs.approve"]);
  const run = async (tx: Db) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId }, include: { lineItems: true } });
    if (!inv) throw notFound();
    if (inv.status !== "DRAFT") return inv;
    if (inv.totalCents <= 0) throw badRequest("An invoice must have a total greater than $0 before it can be sent.");
    if (inv.lineItems.some((l) => l.description.includes("PRICING REQUIRED"))) throw badRequest("Resolve the 'pricing required' line before sending.");
    const tz = await companyTimeZone(tx);
    const issue = todayKey(tz);
    const sent = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "SENT", sentAt: new Date(), issueDate: dateFromKey(issue), dueDate: dateFromKey(addDays(issue, inv.paymentTermsDays)), updatedById: actor.userId },
    });
    await renderAndStoreInvoicePdf(tx, invoiceId, actor.userId);
    await audit(tx, { actorId: actor.userId, action: "invoice.send", entityType: "Invoice", entityId: invoiceId, organizationId: inv.organizationId, after: { status: "SENT", totalCents: inv.totalCents } });
    await notify(tx, {
      userIds: await invoiceRecipients(tx, inv),
      type: "invoice.issued",
      title: `Invoice ${inv.invoiceNumber} — ${formatCents(inv.totalCents)}`,
      body: `A new invoice is available. Amount due ${formatCents(inv.balanceCents)} by ${formatDateKey(addDays(issue, inv.paymentTermsDays), "long")}.`,
      link: `/customer/invoices/${inv.id}`,
      entityType: "Invoice",
      entityId: inv.id,
      dedupeKey: `invoice:${inv.id}:issued`,
    });
    return sent;
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run, { timeout: 30_000 });
}

export async function renderAndStoreInvoicePdf(db: Db, invoiceId: string, actorId: string | null) {
  const { renderInvoicePdf } = await import("../pdf/invoice-pdf");
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const bytes = await renderInvoicePdf(db, invoiceId);
  await db.document.updateMany({ where: { invoiceId, type: "INVOICE", deletedAt: null }, data: { visibility: "INTERNAL", deletedAt: new Date() } });
  return storeDocument(db, {
    bytes,
    fileName: `${inv.invoiceNumber}.pdf`,
    title: `Invoice ${inv.invoiceNumber}`,
    type: "INVOICE",
    visibility: "CUSTOMER",
    organizationId: inv.organizationId,
    locationId: inv.serviceLocationId ?? inv.billingLocationId,
    invoiceId,
    jobId: inv.jobId,
    uploadedById: actorId,
    trusted: { mime: "application/pdf", ext: "pdf" },
  });
}

export async function voidInvoice(actor: Actor, invoiceId: string, reason: string) {
  assertStaffActor(actor, "invoices.void");
  if (reason.trim().length < 3) throw badRequest("A reason is required.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw notFound();
    if (inv.status === "VOID") return;
    if (inv.amountPaidCents > 0) throw badRequest("Refund applied payments before voiding this invoice.");
    if ((await tx.paymentAllocation.count({ where: { invoiceId, payment: { status: { in: ["PENDING", "PROCESSING"] } } } })) > 0) throw badRequest("A payment for this invoice is still processing.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "VOID", voidedAt: new Date(), voidReason: reason, balanceCents: 0, updatedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "invoice.void", entityType: "Invoice", entityId: invoiceId, organizationId: inv.organizationId, before: { status: inv.status, balanceCents: inv.balanceCents }, after: { status: "VOID" }, reason });
  });
}

export async function writeOffInvoice(actor: Actor, invoiceId: string, reason: string) {
  assertStaffActor(actor, "invoices.void");
  if (reason.trim().length < 3) throw badRequest("A reason is required.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw notFound();
    if (!["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status)) throw badRequest("Only open invoices can be written off.");
    await tx.invoice.update({ where: { id: invoiceId }, data: { status: "WRITTEN_OFF", updatedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "invoice.write_off", entityType: "Invoice", entityId: invoiceId, organizationId: inv.organizationId, before: { status: inv.status, balanceCents: inv.balanceCents }, after: { status: "WRITTEN_OFF" }, reason });
  });
}

export async function markInvoiceViewed(invoiceId: string) {
  const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv || inv.viewedAt || inv.status !== "SENT") return;
  await prisma.invoice.update({ where: { id: invoiceId }, data: { viewedAt: new Date(), status: "VIEWED" } });
}

/** Recompute derived status after a balance change. */
export async function refreshInvoiceStatus(db: Db, invoiceId: string) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const tz = await companyTimeZone(db);
  const status = deriveInvoiceStatus({ status: inv.status as InvoiceStatus, totalCents: inv.totalCents, amountPaidCents: inv.amountPaidCents, dueDate: keyFromDate(inv.dueDate), viewedAt: inv.viewedAt, today: todayKey(tz) });
  if (status !== inv.status) {
    await db.invoice.update({ where: { id: invoiceId }, data: { status, paidAt: status === "PAID" ? new Date() : null } });
  }
  return status;
}

/** Apply a settled allocation exactly once (guarded by the `applied` flag). */
export async function applyAllocation(db: Db, allocationId: string) {
  const res = await db.paymentAllocation.updateMany({ where: { id: allocationId, applied: false }, data: { applied: true } });
  if (res.count === 0) return false; // already applied — duplicate webhook or retry
  const a = await db.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId } });
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId } });
  if (inv.status === "VOID") throw badRequest(`Invoice ${inv.invoiceNumber} is void; payment requires manual review.`);
  const paid = Math.min(inv.totalCents, inv.amountPaidCents + a.amountCents);
  await db.invoice.update({ where: { id: inv.id }, data: { amountPaidCents: paid, balanceCents: inv.totalCents - paid } });
  await refreshInvoiceStatus(db, inv.id);
  return true;
}

/** Reverse part of an applied allocation (refunds, lost disputes). */
export async function reverseAllocation(db: Db, invoiceId: string, amountCents: number) {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
  const paid = Math.max(0, inv.amountPaidCents - amountCents);
  const status = inv.status === "PAID" || inv.status === "PARTIALLY_PAID" || inv.status === "OVERDUE" ? "SENT" : inv.status;
  await db.invoice.update({ where: { id: invoiceId }, data: { amountPaidCents: paid, balanceCents: inv.totalCents - paid, status, paidAt: null } });
  await refreshInvoiceStatus(db, invoiceId);
}

/** Cron: flag invoices past due. */
export async function refreshOverdueInvoices() {
  const tz = await companyTimeZone();
  const today = dateFromKey(todayKey(tz));
  const due = await prisma.invoice.findMany({ where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID"] }, dueDate: { lt: today }, balanceCents: { gt: 0 } }, select: { id: true, invoiceNumber: true, balanceCents: true } });
  if (due.length === 0) return { updated: 0 };
  await prisma.invoice.updateMany({ where: { id: { in: due.map((d) => d.id) } }, data: { status: "OVERDUE" } });
  const staff = await staffWithPermission(prisma, "invoices.write");
  for (const d of due) {
    await notify(prisma, { userIds: staff, type: "admin.invoice_overdue", title: `Invoice ${d.invoiceNumber} is overdue`, body: `${formatCents(d.balanceCents)} outstanding.`, link: `/admin/invoices/${d.id}`, entityType: "Invoice", entityId: d.id, dedupeKey: `invoice:${d.id}:overdue` });
  }
  return { updated: due.length };
}

/** Cron: invoice reminders at configured offsets from the due date (negative = before). */
export async function sendInvoiceReminders() {
  const tz = await companyTimeZone();
  const billing = await getSetting("billing");
  const today = todayKey(tz);
  let sent = 0;
  for (const offset of billing.reminderOffsetsDays) {
    const dueKey = addDays(today, -offset);
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 }, dueDate: dateFromKey(dueKey) },
    });
    for (const inv of invoices) {
      const label = offset < 0 ? `due in ${-offset} day${offset === -1 ? "" : "s"}` : offset === 0 ? "due today" : `${offset} days overdue`;
      const ids = await notify(prisma, {
        userIds: await invoiceRecipients(prisma, inv),
        type: "invoice.reminder",
        title: `Invoice ${inv.invoiceNumber} is ${label}`,
        body: `Balance ${formatCents(inv.balanceCents)}. Pay securely online from your Sewer Squad portal.`,
        link: `/customer/invoices/${inv.id}`,
        entityType: "Invoice",
        entityId: inv.id,
        dedupeKey: `invoice:${inv.id}:reminder:${offset}`,
      });
      sent += ids.length;
    }
  }
  return { sent };
}

export function lineKindLabel(kind: string) {
  return LINE_ITEM_KIND_LABEL[kind] ?? kind;
}

export async function assertInvoiceEditable(actor: Actor) {
  if (!actor.permissions.has("invoices.write")) throw forbidden();
}
