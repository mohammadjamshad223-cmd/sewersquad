import "server-only";
import { z } from "zod";
import { Prisma, type DisposalBillStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import type { Actor } from "../auth/session";
import { hasPermission } from "../authz/check";
import { lineAmountCents } from "@/domain/invoice-math";
import { dateFromKey, isDateKey, keyFromDate } from "@/lib/dates";
import { parseDollarRateToCentsString, parseDollarsToCents } from "@/lib/money";
import { storeDocument } from "./documents";

/**
 * Disposal bills are what disposal vendors charge us (accounts payable), entered from their invoices.
 * They are separate from disposal events, which are what a truck physically discharged.
 */

const dateKey = z.string().refine(isDateKey, "Enter a valid date.");
const optionalDateKey = z.string().optional().refine((v) => !v || isDateKey(v), "Enter a valid date.");

export const billLineSchema = z.object({
  description: z.string().trim().min(1, "Describe each line.").max(200),
  wasteType: z.string().trim().max(120).optional(),
  gallons: z.string().trim().optional(),
  rate: z.string().trim().optional(),
  amount: z.string().trim().optional(),
  manifests: z.string().trim().max(500).optional(),
  manifestDate: optionalDateKey,
});
export type BillLineInput = z.infer<typeof billLineSchema>;

export const billSchema = z.object({
  facilityId: z.string().uuid("Select the disposal vendor."),
  vendorInvoiceNumber: z.string().trim().min(1, "Enter the vendor's invoice number.").max(80),
  invoiceDate: dateKey,
  dueDate: optionalDateKey,
  serviceDate: optionalDateKey,
  referenceNumber: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(2000).optional(),
  lines: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid lines." });
        return z.NEVER;
      }
    })
    .pipe(z.array(billLineSchema).min(1, "Add at least one line.").max(50)),
});
export type BillInput = z.infer<typeof billSchema>;

/** Turns form lines into stored lines. A blank amount is computed from gallons × rate. */
export function normalizeBillLines(lines: BillLineInput[]) {
  return lines.map((l, i) => {
    const gallons = l.gallons ? Number(l.gallons.replace(/,/g, "")) : null;
    if (gallons !== null && (!Number.isInteger(gallons) || gallons < 0 || gallons > 1_000_000)) throw badRequest(`Line ${i + 1}: gallons must be a whole number.`);
    const rate = l.rate ? parseDollarRateToCentsString(l.rate) : null;
    if (l.rate && rate === null) throw badRequest(`Line ${i + 1}: enter a rate such as 0.185`);
    let amountCents: number | null = l.amount ? parseDollarsToCents(l.amount) : null;
    if (l.amount && (amountCents === null || amountCents < 0)) throw badRequest(`Line ${i + 1}: enter an amount such as 370.00`);
    if (amountCents === null) {
      if (gallons === null || rate === null) throw badRequest(`Line ${i + 1}: enter the amount, or gallons and rate.`);
      amountCents = lineAmountCents(String(gallons), rate);
    }
    return {
      description: l.description,
      wasteType: l.wasteType || null,
      gallons,
      ratePerGallonCents: rate ? new Prisma.Decimal(rate) : null,
      amountCents,
      manifestNumbers: (l.manifests ?? "").split(/[\s,;]+/).map((m) => m.trim()).filter(Boolean),
      manifestDate: l.manifestDate ? dateFromKey(l.manifestDate) : null,
      sortOrder: i,
    };
  });
}

function assertWrite(actor: Actor) {
  if (!hasPermission(actor, "disposal.write")) throw forbidden();
}

export async function createDisposalBill(actor: Actor, input: BillInput, file: { bytes: Uint8Array; name: string } | null) {
  assertWrite(actor);
  const facility = await prisma.disposalFacility.findUnique({ where: { id: input.facilityId } });
  if (!facility) throw badRequest("Select the disposal vendor.");
  const lines = normalizeBillLines(input.lines);
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);
  const exists = await prisma.disposalBill.findUnique({ where: { facilityId_vendorInvoiceNumber: { facilityId: facility.id, vendorInvoiceNumber: input.vendorInvoiceNumber } } });
  if (exists) throw conflict(`Invoice ${input.vendorInvoiceNumber} from ${facility.name} is already entered.`);
  return prisma.$transaction(async (tx) => {
    const bill = await tx.disposalBill.create({
      data: {
        facilityId: facility.id,
        vendorInvoiceNumber: input.vendorInvoiceNumber,
        invoiceDate: dateFromKey(input.invoiceDate),
        dueDate: input.dueDate ? dateFromKey(input.dueDate) : null,
        serviceDate: input.serviceDate ? dateFromKey(input.serviceDate) : null,
        referenceNumber: input.referenceNumber || null,
        notes: input.notes || null,
        totalCents,
        createdById: actor.userId,
        lines: { create: lines },
      },
    });
    if (file) {
      await storeDocument(tx, { bytes: file.bytes, fileName: file.name, type: "DISPOSAL_INVOICE", title: `${facility.name} invoice ${input.vendorInvoiceNumber}`, disposalBillId: bill.id, uploadedById: actor.userId });
    }
    await audit(tx, { actorId: actor.userId, action: "disposal_bill.create", entityType: "DisposalBill", entityId: bill.id, after: { ...input, totalCents } });
    return bill;
  });
}

export const billStatusSchema = z.discriminatedUnion("status", [
  z.object({ billId: z.string().uuid(), status: z.literal("PAID"), paidAt: dateKey, paymentReference: z.string().trim().max(120).optional() }),
  z.object({ billId: z.string().uuid(), status: z.literal("OPEN") }),
  z.object({ billId: z.string().uuid(), status: z.literal("VOID"), reason: z.string().trim().min(3, "Say why this bill is void.").max(500) }),
]);

/** Mark paid (date + check/confirmation #), re-open a bill marked paid by mistake, or void a duplicate. */
export async function setDisposalBillStatus(actor: Actor, input: z.infer<typeof billStatusSchema>) {
  assertWrite(actor);
  const bill = await prisma.disposalBill.findUnique({ where: { id: input.billId } });
  if (!bill) throw notFound();
  if (bill.status === "VOID") throw badRequest("This bill is void.");
  const data: Prisma.DisposalBillUpdateInput =
    input.status === "PAID"
      ? { status: "PAID", paidAt: dateFromKey(input.paidAt), paymentReference: input.paymentReference || null }
      : input.status === "OPEN"
        ? { status: "OPEN", paidAt: null, paymentReference: null }
        : { status: "VOID", notes: [bill.notes, `Void: ${input.reason}`].filter(Boolean).join("\n") };
  return prisma.$transaction(async (tx) => {
    const updated = await tx.disposalBill.update({ where: { id: bill.id }, data });
    await audit(tx, {
      actorId: actor.userId,
      action: `disposal_bill.${input.status.toLowerCase()}`,
      entityType: "DisposalBill",
      entityId: bill.id,
      before: { status: bill.status, paidAt: bill.paidAt, paymentReference: bill.paymentReference },
      after: input,
    });
    return updated;
  });
}

export type BillFilters = { from: string; to: string; facilityId?: string; status?: DisposalBillStatus };

export function billWhere(f: BillFilters): Prisma.DisposalBillWhereInput {
  return {
    invoiceDate: { gte: dateFromKey(f.from), lte: dateFromKey(f.to) },
    ...(f.facilityId ? { facilityId: f.facilityId } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
}

export async function listDisposalBills(f: BillFilters) {
  return prisma.disposalBill.findMany({
    where: billWhere(f),
    include: { facility: { select: { id: true, name: true } }, lines: { orderBy: { sortOrder: "asc" } }, documents: { where: { deletedAt: null }, select: { id: true } } },
    orderBy: [{ invoiceDate: "desc" }, { vendorInvoiceNumber: "desc" }],
    take: 1000,
  });
}

/** gallonCostCents = the part of the total on lines that list gallons (statement-only lines have none). */
type SummaryBill = { facilityId: string; facilityName: string; invoiceDate: Date; status: DisposalBillStatus; totalCents: number; gallons: number; gallonCostCents: number };

/** Pure roll-up so it can be unit tested. Void bills are excluded from every figure. */
export function summarizeBills(bills: SummaryBill[]) {
  const live = bills.filter((b) => b.status !== "VOID");
  const sum = (xs: SummaryBill[], k: "totalCents" | "gallons" | "gallonCostCents") => xs.reduce((s, b) => s + b[k], 0);
  const billedCents = sum(live, "totalCents");
  const gallons = sum(live, "gallons");
  const byVendor = new Map<string, { facilityId: string; name: string; bills: number; billedCents: number; openCents: number; gallons: number }>();
  const byMonth = new Map<string, { month: string; billedCents: number; gallons: number }>();
  for (const b of live) {
    const v = byVendor.get(b.facilityId) ?? { facilityId: b.facilityId, name: b.facilityName, bills: 0, billedCents: 0, openCents: 0, gallons: 0 };
    v.bills += 1;
    v.billedCents += b.totalCents;
    v.gallons += b.gallons;
    if (b.status === "OPEN") v.openCents += b.totalCents;
    byVendor.set(b.facilityId, v);
    const month = keyFromDate(b.invoiceDate).slice(0, 7);
    const m = byMonth.get(month) ?? { month, billedCents: 0, gallons: 0 };
    m.billedCents += b.totalCents;
    m.gallons += b.gallons;
    byMonth.set(month, m);
  }
  return {
    bills: live.length,
    billedCents,
    openCents: sum(live.filter((b) => b.status === "OPEN"), "totalCents"),
    paidCents: sum(live.filter((b) => b.status === "PAID"), "totalCents"),
    gallons,
    /** Average cost per gallon in cents, over lines that list gallons. */
    centsPerGallon: gallons > 0 ? sum(live, "gallonCostCents") / gallons : null,
    byVendor: [...byVendor.values()].sort((a, b) => b.billedCents - a.billedCents),
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

export async function disposalBillSummary(f: BillFilters) {
  const bills = await prisma.disposalBill.findMany({ where: billWhere(f), include: { facility: { select: { name: true } }, lines: { select: { gallons: true, amountCents: true } } } });
  const openAll = await prisma.disposalBill.aggregate({ where: { status: "OPEN" }, _sum: { totalCents: true }, _count: true });
  return {
    ...summarizeBills(bills.map((b) => ({ facilityId: b.facilityId, facilityName: b.facility.name, invoiceDate: b.invoiceDate, status: b.status, totalCents: b.totalCents, gallons: b.lines.reduce((s, l) => s + (l.gallons ?? 0), 0), gallonCostCents: b.lines.reduce((s, l) => s + (l.gallons !== null ? l.amountCents : 0), 0) }))),
    /** Everything still owed, regardless of the date filter. */
    openAllCents: openAll._sum.totalCents ?? 0,
    openAllCount: openAll._count,
  };
}
