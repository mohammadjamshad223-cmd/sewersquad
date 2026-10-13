import "server-only";
import type { InvoiceStatus, JobStatus, PaymentStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { dateFromKey } from "@/lib/dates";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatAddress } from "@/lib/utils";
import { describeRule } from "@/domain/recurrence";
import { day, dollars, instantRange, ratePerGallon, type ApiQuery, type Page } from "./core";

const OPEN: InvoiceStatus[] = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"];
/** Drafts aren't sent yet and void invoices never count, so neither is exposed. */
const LISTED: InvoiceStatus[] = [...OPEN, "PAID", "WRITTEN_OFF"];
const skip = (q: ApiQuery) => (q.page - 1) * q.limit;
const dateRange = (q: ApiQuery) => (q.from || q.to ? { ...(q.from ? { gte: dateFromKey(q.from) } : {}), ...(q.to ? { lte: dateFromKey(q.to) } : {}) } : undefined);

/** paid / unpaid / overdue as an agent would mean it, from the stored invoice state. */
function paymentStatus(i: { status: InvoiceStatus; dueDate: Date; balanceCents: number }, today: string) {
  if (i.status === "PAID") return "paid";
  if (i.status === "WRITTEN_OFF") return "written_off";
  if (i.status === "DRAFT") return "draft";
  if (i.status === "VOID") return "void";
  return day(i.dueDate)! < today && i.balanceCents > 0 ? "overdue" : "unpaid";
}

function invoiceStatusWhere(status: ApiQuery["status"], today: string): Prisma.InvoiceWhereInput {
  if (status === "paid") return { status: "PAID" };
  if (status === "unpaid") return { status: { in: OPEN }, balanceCents: { gt: 0 } };
  if (status === "overdue") return { status: { in: OPEN }, balanceCents: { gt: 0 }, dueDate: { lt: dateFromKey(today) } };
  return { status: { in: LISTED } };
}

// ── Invoices ─────────────────────────────────────────────────────────────────

export async function listInvoices(q: ApiQuery): Promise<Page<unknown>> {
  const where: Prisma.InvoiceWhereInput = {
    isDemo: false,
    ...invoiceStatusWhere(q.status, q.today),
    ...(q.customer_id ? { organizationId: q.customer_id } : {}),
    ...(dateRange(q) ? { issueDate: dateRange(q) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        serviceLocation: { select: { id: true, name: true } },
        lineItems: { where: { kind: "PER_GALLON" }, select: { quantity: true, unitPriceCents: true } },
        job: { select: { serviceRecord: { select: { assetRecords: { select: { gallonsPumped: true } } } } } },
      },
      orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }],
      skip: skip(q),
      take: q.limit,
    }),
    prisma.invoice.count({ where }),
  ]);
  return {
    total,
    data: rows.map((i) => {
      const lineGallons = i.lineItems.reduce((s, l) => s + Number(l.quantity), 0);
      const jobGallons = i.job?.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0;
      const gallons = jobGallons || lineGallons;
      return {
        id: i.id,
        number: i.invoiceNumber,
        customer: { id: i.organization.id, name: i.organization.name },
        location: i.serviceLocation ? { id: i.serviceLocation.id, name: i.serviceLocation.name } : null,
        service: i.serviceTitle,
        service_date: day(i.serviceDate),
        issue_date: day(i.issueDate),
        due_date: day(i.dueDate),
        gallons: gallons ? Math.round(gallons * 1000) / 1000 : null,
        price_per_gallon: ratePerGallon(i.lineItems[0]?.unitPriceCents),
        total: dollars(i.totalCents),
        amount_paid: dollars(i.amountPaidCents),
        balance: dollars(i.balanceCents),
        status: paymentStatus(i, q.today),
      };
    }),
  };
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

const NOT_DONE: JobStatus[] = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "MISSED", "UNABLE_TO_SERVICE"];

function jobStatusWhere(status: ApiQuery["status"], today: string): Prisma.JobWhereInput {
  // paid / unpaid follow the job's invoice; overdue means the service itself is past due.
  if (status === "paid") return { invoices: { some: { status: "PAID" } } };
  if (status === "unpaid") return { invoices: { some: { status: { in: OPEN }, balanceCents: { gt: 0 } } } };
  if (status === "overdue") return { status: { in: NOT_DONE }, scheduledDate: { lt: dateFromKey(today) } };
  return {};
}

export async function listJobs(q: ApiQuery): Promise<Page<unknown>> {
  const where: Prisma.JobWhereInput = {
    isDemo: false,
    ...jobStatusWhere(q.status, q.today),
    ...(q.customer_id ? { organizationId: q.customer_id } : {}),
    ...(dateRange(q) ? { scheduledDate: dateRange(q) } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.job.findMany({
      where,
      include: {
        organization: { select: { id: true, name: true } },
        location: { select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true } },
        serviceRecord: { select: { assetRecords: { select: { gallonsPumped: true } } } },
        loadAllocations: { select: { disposalEvent: { select: { disposedAt: true, facility: { select: { name: true } } } } } },
        plan: { select: { pricingModel: true, flatPriceCents: true, perGallonCents: true } },
        invoices: { where: { status: { notIn: ["VOID"] } }, select: { id: true, invoiceNumber: true, totalCents: true, status: true, dueDate: true, balanceCents: true }, take: 1 },
      },
      orderBy: [{ scheduledDate: "desc" }, { jobNumber: "desc" }],
      skip: skip(q),
      take: q.limit,
    }),
    prisma.job.count({ where }),
  ]);
  return {
    total,
    data: rows.map((j) => {
      const gallons = j.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? null;
      const inv = j.invoices[0] ?? null;
      const site = [...j.loadAllocations].sort((a, b) => b.disposalEvent.disposedAt.getTime() - a.disposalEvent.disposedAt.getTime())[0]?.disposalEvent.facility.name ?? null;
      const perGallon = j.plan?.pricingModel === "PER_GALLON" ? ratePerGallon(j.plan.perGallonCents) : null;
      const price = inv ? dollars(inv.totalCents) : j.quotedPriceCents !== null ? dollars(j.quotedPriceCents) : j.plan?.pricingModel === "FLAT_RATE" ? dollars(j.plan.flatPriceCents) : perGallon !== null && gallons ? Math.round(perGallon * gallons * 100) / 100 : null;
      return {
        id: j.id,
        number: j.jobNumber,
        customer: { id: j.organization.id, name: j.organization.name },
        location: j.location.name,
        address: formatAddress(j.location),
        date: day(j.scheduledDate),
        service_type: SERVICE_TYPE_LABEL[j.serviceType] ?? j.serviceType,
        job_type: j.type.toLowerCase(),
        gallons: gallons ?? null,
        estimated_gallons: j.estimatedGallons,
        disposal_site: site,
        price,
        price_per_gallon: perGallon,
        invoice: inv ? { id: inv.id, number: inv.invoiceNumber, status: paymentStatus(inv, q.today) } : null,
        status: j.status.toLowerCase(),
        completed_at: j.completedAt?.toISOString() ?? null,
      };
    }),
  };
}

// ── Customers ────────────────────────────────────────────────────────────────

function customerStatusWhere(status: ApiQuery["status"], today: string): Prisma.OrganizationWhereInput {
  const open = { status: { in: OPEN }, balanceCents: { gt: 0 }, isDemo: false };
  if (status === "paid") return { invoices: { none: open } };
  if (status === "unpaid") return { invoices: { some: open } };
  if (status === "overdue") return { invoices: { some: { ...open, dueDate: { lt: dateFromKey(today) } } } };
  return {};
}

export async function listCustomers(q: ApiQuery): Promise<Page<unknown>> {
  const created = await instantRange(q.tz, q.from, q.to);
  const where: Prisma.OrganizationWhereInput = {
    deletedAt: null,
    isDemo: false,
    ...customerStatusWhere(q.status, q.today),
    ...(q.customer_id ? { id: q.customer_id } : {}),
    ...(created ? { createdAt: created } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.organization.findMany({
      where,
      include: {
        contacts: { orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true, phone: true, email: true } },
        locations: { where: { deletedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, addressLine1: true, addressLine2: true, city: true, state: true, postalCode: true, status: true } },
        plans: { where: { status: "ACTIVE" }, orderBy: { createdAt: "asc" }, select: { locationId: true, pricingModel: true, perGallonCents: true, flatPriceCents: true, nextServiceDate: true, recurrenceRule: { select: { unit: true, interval: true, anchor: true } } } },
        pricingRules: { where: { active: true, kind: "PER_GALLON" }, orderBy: { createdAt: "desc" }, take: 1, select: { amountCents: true } },
        billingProfiles: { orderBy: [{ isDefault: "desc" }], take: 1, select: { paymentTermsDays: true, billingEmail: true } },
      },
      orderBy: { name: "asc" },
      skip: skip(q),
      take: q.limit,
    }),
    prisma.organization.count({ where }),
  ]);
  const balances = await prisma.invoice.groupBy({ by: ["organizationId"], where: { organizationId: { in: rows.map((r) => r.id) }, status: { in: OPEN } }, _sum: { balanceCents: true } });
  return {
    total,
    data: rows.map((o) => {
      const contact = o.contacts[0];
      const plan = o.plans[0];
      const terms = o.billingProfiles[0]?.paymentTermsDays;
      const perGallon = o.plans.find((p) => p.pricingModel === "PER_GALLON" && p.perGallonCents !== null)?.perGallonCents ?? o.pricingRules[0]?.amountCents ?? null;
      return {
        id: o.id,
        name: o.name,
        account_number: o.accountNumber,
        contact_name: contact?.name ?? null,
        phone: contact?.phone ?? o.primaryPhone,
        email: contact?.email ?? o.primaryEmail ?? o.billingProfiles[0]?.billingEmail ?? null,
        address: o.locations[0] ? formatAddress(o.locations[0]) : null,
        locations: o.locations.map((l) => ({ id: l.id, name: l.name, address: formatAddress(l), active: l.status === "ACTIVE" })),
        service_frequency: plan ? describeRule(plan.recurrenceRule).replace(/ · .*$/, "") : null,
        next_service_date: day(plan?.nextServiceDate),
        price_per_gallon: ratePerGallon(perGallon),
        flat_price: plan?.pricingModel === "FLAT_RATE" ? dollars(plan.flatPriceCents) : null,
        payment_terms: terms === undefined ? null : terms === 0 ? "Due on receipt" : `Net ${terms}`,
        payment_terms_days: terms ?? null,
        balance: dollars(balances.find((b) => b.organizationId === o.id)?._sum.balanceCents ?? 0),
        active: o.status === "ACTIVE",
      };
    }),
  };
}

// ── Payments ─────────────────────────────────────────────────────────────────

function paymentStatusWhere(status: ApiQuery["status"]): Prisma.PaymentWhereInput {
  // A payment is "paid" once it has settled; "unpaid" covers pending and failed attempts.
  const settled: PaymentStatus[] = ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"];
  if (status === "paid") return { status: { in: settled } };
  if (status === "unpaid") return { status: { in: ["PENDING", "PROCESSING", "FAILED"] } };
  if (status === "overdue") return { id: { in: [] } }; // payments can't be overdue; invoices can
  return { status: { notIn: ["CANCELLED"] } };
}

export async function listPayments(q: ApiQuery): Promise<Page<unknown>> {
  const range = await instantRange(q.tz, q.from, q.to);
  const where: Prisma.PaymentWhereInput = {
    isDemo: false,
    ...paymentStatusWhere(q.status),
    ...(q.customer_id ? { organizationId: q.customer_id } : {}),
    ...(range ? { OR: [{ receivedAt: range }, { receivedAt: null, createdAt: range }] } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { organization: { select: { id: true, name: true } }, allocations: { select: { invoiceId: true, amountCents: true, invoice: { select: { invoiceNumber: true } } } } },
      orderBy: [{ receivedAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      skip: skip(q),
      take: q.limit,
    }),
    prisma.payment.count({ where }),
  ]);
  return {
    total,
    data: rows.map((p) => ({
      id: p.id,
      number: p.paymentNumber,
      invoice_id: p.allocations[0]?.invoiceId ?? null,
      invoices: p.allocations.map((a) => ({ id: a.invoiceId, number: a.invoice.invoiceNumber, amount: dollars(a.amountCents) })),
      customer: { id: p.organization.id, name: p.organization.name },
      amount: dollars(p.amountCents),
      refunded: dollars(p.refundedCents),
      date: (p.receivedAt ?? p.createdAt).toISOString(),
      method: p.method.toLowerCase(),
      status: p.status.toLowerCase(),
      reference: p.reference,
    })),
  };
}

