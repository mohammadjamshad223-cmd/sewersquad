import "server-only";
import { Prisma, type LineItemKind, type ManifestFeeType, type OrganizationType, type ServiceType } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { computeInvoiceTotals } from "@/domain/invoice-math";
import { compareKeys, dateFromKey, todayKey } from "@/lib/dates";
import { companyTimeZone, getSetting, updateSetting } from "./settings";
import { renderAndStoreInvoicePdf } from "./invoices";
import { storeProposalPdf } from "./proposals";
import { storeReportPdf } from "./service-reports";
import { materializePlan } from "./plans";
import records from "../import/records-2026.json";

/**
 * One-time import of the records Sewer Squad kept before the portal (June–September 2026):
 * customers and locations, invoices 002–072 (001 and 003 were never confirmed), proposals and quotes, two service reports, and
 * 90-day service plans. Every step is idempotent (matched by name, address or document number),
 * runs in small batches so no request hits a host time limit, and can be re-run safely.
 */

type Line = { kind: string; description: string; quantity: string; unitPriceCents: string; amountCents: number };
type ImportInvoice = { number: string; date: string; nextServiceDate: string | null; serviceTitle: string; serviceType: string; assetType: string | null; gallons: number | null; rate: string | null; totalCents: number | null; lines: Line[]; source: string; location: string; status: "ISSUED" | "DRAFT"; reconstructed?: boolean };
type ImportLocation = { key: string; name: string; addressLine1: string; city: string; state: string; postalCode: string; manifestFee: string };
type ImportOrg = { key: string; name: string; type: string; locations: ImportLocation[] };
type ImportProposal = { number: string; date: string; kind: "PROPOSAL" | "QUOTE"; status: "DRAFT" | "SENT"; preparedFor: string; addressLine1: string; city: string; state: string; postalCode: string; scopeTitle: string; scopeSubtitle?: string; intro?: string; note?: string; priceNote?: string | null; totalCents: number | null; source: string; linkLocation?: string; sections: { title: string | null; subtotalLabel: string | null; lines: Line[] }[] };
type ImportReport = { number: string; invoice: string; location: string; preparedFor: string; addressLine1: string; city: string; state: string; postalCode: string; serviceDate: string; subject: string; sections: { title: string; body: string }[]; closing: string; source: string };
type Records = { organizations: ImportOrg[]; invoices: ImportInvoice[]; proposals: ImportProposal[]; reports: ImportReport[]; company: { name: string; addressLine1: string; city: string; state: string; phone: string; email: string; tceqNumber: string } };

export const RECORDS = records as unknown as Records;
const TRAP_TYPES = ["GREASE_TRAP_PUMPING", "GRIT_TRAP_CLEANING"];
const BATCH = 8;

export const PHASES = ["company", "customers", "invoices", "proposals", "reports", "plans", "done"] as const;
export type ImportPhase = (typeof PHASES)[number];
export type ImportOptions = { unpaid: string[]; applyCompany: boolean; createPlans: boolean };
export type ImportStep = { phase: ImportPhase; cursor: number };
export type StepResult = { next: ImportStep; log: string[] };

function locIndex() {
  const m = new Map<string, { org: ImportOrg; loc: ImportLocation }>();
  for (const org of RECORDS.organizations) for (const loc of org.locations) m.set(loc.key, { org, loc });
  return m;
}

async function findLocation(db: Db, key: string) {
  const hit = locIndex().get(key);
  if (!hit) return null;
  const org = await db.organization.findFirst({ where: { name: { equals: hit.org.name, mode: "insensitive" }, deletedAt: null } });
  if (!org) return null;
  const loc = await db.serviceLocation.findFirst({ where: { organizationId: org.id, addressLine1: { equals: hit.loc.addressLine1, mode: "insensitive" }, deletedAt: null } });
  return loc ? { org, loc } : null;
}

/** What is in the bundled records and what already exists in the portal. */
export async function importPreview() {
  const [invoices, proposals, reports, orgs] = await Promise.all([
    prisma.invoice.findMany({ where: { invoiceNumber: { in: RECORDS.invoices.map((i) => i.number) } }, select: { invoiceNumber: true } }),
    prisma.proposal.findMany({ where: { number: { in: RECORDS.proposals.map((p) => p.number) } }, select: { number: true } }),
    prisma.serviceReport.findMany({ where: { number: { in: RECORDS.reports.map((r) => r.number) } }, select: { number: true } }),
    prisma.organization.findMany({ where: { deletedAt: null, OR: RECORDS.organizations.map((o) => ({ name: { equals: o.name, mode: "insensitive" as const } })) }, select: { name: true } }),
  ]);
  const has = new Set(invoices.map((i) => i.invoiceNumber));
  return {
    customers: RECORDS.organizations.length,
    existingCustomers: orgs.length,
    locations: RECORDS.organizations.reduce((s, o) => s + o.locations.length, 0),
    invoices: RECORDS.invoices.map((i) => ({ number: i.number, date: i.date, client: locIndex().get(i.location)?.loc.name ?? "", service: i.serviceTitle, totalCents: i.totalCents ?? 0, draft: i.status === "DRAFT", reconstructed: !!i.reconstructed, imported: has.has(i.number) })),
    proposals: RECORDS.proposals.map((p) => ({ number: p.number, preparedFor: p.preparedFor, totalCents: p.totalCents, priceNote: p.priceNote ?? null, imported: proposals.some((x) => x.number === p.number) })),
    reports: RECORDS.reports.map((r) => ({ number: r.number, preparedFor: r.preparedFor, subject: r.subject, imported: reports.some((x) => x.number === r.number) })),
    company: RECORDS.company,
  };
}

export async function runImportStep(actor: Actor, opts: ImportOptions, step: ImportStep): Promise<StepResult> {
  assertStaffActor(actor, "settings.write");
  if (!PHASES.includes(step.phase)) throw badRequest("Unknown import step.");
  const unpaid = new Set(opts.unpaid);
  switch (step.phase) {
    case "company":
      return { next: { phase: "customers", cursor: 0 }, log: opts.applyCompany ? await applyCompany(actor) : ["Company details left unchanged."] };
    case "customers":
      return { next: { phase: "invoices", cursor: 0 }, log: await prisma.$transaction((tx) => importCustomers(tx, actor), { timeout: 55_000 }) };
    case "invoices": {
      const slice = RECORDS.invoices.slice(step.cursor, step.cursor + BATCH);
      const log: string[] = [];
      for (const inv of slice) log.push(await prisma.$transaction((tx) => importInvoice(tx, actor, inv, !unpaid.has(inv.number)), { timeout: 30_000 }));
      const cursor = step.cursor + BATCH;
      return { next: cursor < RECORDS.invoices.length ? { phase: "invoices", cursor } : { phase: "proposals", cursor: 0 }, log };
    }
    case "proposals": {
      const log: string[] = [];
      for (const p of RECORDS.proposals) log.push(await prisma.$transaction((tx) => importProposal(tx, actor, p), { timeout: 30_000 }));
      return { next: { phase: "reports", cursor: 0 }, log };
    }
    case "reports": {
      const log: string[] = [];
      for (const r of RECORDS.reports) log.push(await prisma.$transaction((tx) => importReport(tx, actor, r), { timeout: 30_000 }));
      return { next: { phase: opts.createPlans ? "plans" : "done", cursor: 0 }, log };
    }
    case "plans":
      return { next: { phase: "done", cursor: 0 }, log: await prisma.$transaction((tx) => importPlans(tx, actor), { timeout: 55_000 }) };
    case "done":
      return { next: step, log: [] };
  }
}

/** Fills company details that are still blank (never overwrites what the owner already entered). */
async function applyCompany(actor: Actor) {
  const c = RECORDS.company;
  const [company, hauler, billing] = await Promise.all([getSetting("company"), getSetting("hauler"), getSetting("billing")]);
  const log: string[] = [];
  const fill = <T extends Record<string, unknown>>(cur: T, patch: Partial<T>, isBlank: (k: keyof T) => boolean) => {
    const out = { ...cur };
    for (const [k, v] of Object.entries(patch) as [keyof T, T[keyof T]][]) if (isBlank(k)) out[k] = v;
    return out;
  };
  const nextCompany = fill(company, { name: c.name, addressLine1: c.addressLine1, city: c.city, state: c.state, phone: c.phone, email: c.email }, (k) => !company[k] || (k === "name" && company.name === "Sewer Squad"));
  if (JSON.stringify(nextCompany) !== JSON.stringify(company)) {
    await updateSetting("company", nextCompany, actor.userId);
    log.push("Company name, address, phone and email filled in.");
  }
  const nextHauler = fill(hauler, { legalName: c.name, tceqNumber: c.tceqNumber }, (k) => !hauler[k]);
  if (JSON.stringify(nextHauler) !== JSON.stringify(hauler)) {
    await updateSetting("hauler", nextHauler, actor.userId);
    log.push(`TCEQ #${nextHauler.tceqNumber} set. City of Houston # left blank until you enter it.`);
  }
  if (billing.defaultPaymentTermsDays === 30) {
    await updateSetting("billing", { ...billing, defaultPaymentTermsDays: 0, invoiceFooter: billing.invoiceFooter === "Thank you for your business." ? "Thank you for your business!" : billing.invoiceFooter }, actor.userId);
    log.push("Default payment terms set to due upon receipt (as on your invoices).");
  }
  return log.length ? log : ["Company details already set."];
}

async function importCustomers(tx: Db, actor: Actor) {
  let orgs = 0;
  let locs = 0;
  for (const o of RECORDS.organizations) {
    let org = await tx.organization.findFirst({ where: { name: { equals: o.name, mode: "insensitive" }, deletedAt: null } });
    if (!org) {
      org = await tx.organization.create({ data: { name: o.name, type: o.type as OrganizationType, accountNumber: await numbers.account(tx), notes: "Imported from records kept before the portal (Jun–Sep 2026).", createdById: actor.userId, updatedById: actor.userId } });
      await tx.billingProfile.create({ data: { organizationId: org.id, name: `${o.name} — Billing`, isDefault: true, paymentTermsDays: 0 } });
      orgs++;
    }
    for (const l of o.locations) {
      const exists = await tx.serviceLocation.findFirst({ where: { organizationId: org.id, addressLine1: { equals: l.addressLine1, mode: "insensitive" }, deletedAt: null } });
      if (exists) continue;
      await tx.serviceLocation.create({ data: { organizationId: org.id, code: await numbers.location(tx), name: l.name, addressLine1: l.addressLine1, city: l.city, state: l.state, postalCode: l.postalCode, manifestFee: l.manifestFee as ManifestFeeType, createdById: actor.userId, updatedById: actor.userId } });
      locs++;
    }
  }
  await audit(tx, { actorId: actor.userId, action: "import.customers", entityType: "Import", entityId: "records-2026", after: { orgs, locs } });
  return [`${orgs} customers and ${locs} locations added (${RECORDS.organizations.length - orgs} customers already existed).`];
}

async function importInvoice(tx: Db, actor: Actor, i: ImportInvoice, paid: boolean) {
  if (await tx.invoice.findUnique({ where: { invoiceNumber: i.number } })) return `Invoice ${i.number}: already in the portal.`;
  const hit = await findLocation(tx, i.location);
  if (!hit) throw badRequest(`Invoice ${i.number}: its customer location is missing. Run the import from the start.`);
  const totals = computeInvoiceTotals(i.lines.map((l) => ({ kind: l.kind, quantity: l.quantity, unitPriceCents: l.unitPriceCents, taxable: false })), 0);
  if (i.totalCents !== null && totals.totalCents !== i.totalCents) throw badRequest(`Invoice ${i.number}: lines don't add up to the recorded total.`);
  const profile = await tx.billingProfile.findFirst({ where: { organizationId: hit.org.id, isDefault: true } });
  const draft = i.status === "DRAFT";
  const issued = dateFromKey(i.date);
  const settled = paid && !draft && totals.totalCents > 0;
  const inv = await tx.invoice.create({
    data: {
      invoiceNumber: i.number,
      organizationId: hit.org.id,
      billingProfileId: profile?.id ?? null,
      serviceLocationId: hit.loc.id,
      status: draft ? "DRAFT" : settled ? "PAID" : "SENT",
      serviceDate: issued,
      issueDate: issued,
      dueDate: issued,
      paymentTermsDays: 0,
      subtotalCents: totals.subtotalCents,
      discountCents: totals.discountCents,
      totalCents: totals.totalCents,
      amountPaidCents: settled ? totals.totalCents : 0,
      balanceCents: settled ? 0 : totals.totalCents,
      serviceTitle: i.serviceTitle,
      nextServiceDate: i.nextServiceDate ? dateFromKey(i.nextServiceDate) : null,
      legacySource: i.source,
      sentAt: draft ? null : issued,
      paidAt: settled ? issued : null,
      createdById: actor.userId,
      updatedById: actor.userId,
      lineItems: { create: i.lines.map((l, n) => ({ kind: l.kind as LineItemKind, description: l.description, quantity: new Prisma.Decimal(l.quantity), unitPriceCents: new Prisma.Decimal(l.unitPriceCents), amountCents: totals.lines[n]!.amountCents, taxable: false, sortOrder: n })) },
    },
  });
  if (settled) {
    await tx.payment.create({
      data: {
        paymentNumber: await numbers.payment(tx),
        organizationId: hit.org.id,
        method: "OTHER",
        status: "SUCCEEDED",
        amountCents: totals.totalCents,
        reference: "Paid before the portal",
        notes: `Recorded when invoice ${i.number} was imported. Edit the method or reference if you have them.`,
        receivedAt: issued,
        recordedById: actor.userId,
        allocations: { create: { invoiceId: inv.id, amountCents: totals.totalCents, applied: true } },
      },
    });
  }
  if (!draft) await renderAndStoreInvoicePdf(tx, inv.id, actor.userId);
  await audit(tx, { actorId: actor.userId, action: "import.invoice", entityType: "Invoice", entityId: inv.id, organizationId: hit.org.id, after: { number: i.number, totalCents: totals.totalCents, paid: settled, source: i.source } });
  return `Invoice ${i.number} (${hit.loc.name}): ${draft ? "draft — pricing needed" : settled ? "paid" : "open"}.`;
}

async function importProposal(tx: Db, actor: Actor, p: ImportProposal) {
  if (await tx.proposal.findUnique({ where: { number: p.number } })) return `${p.number}: already in the portal.`;
  const hit = p.linkLocation ? await findLocation(tx, p.linkLocation) : null;
  const created = await tx.proposal.create({
    data: {
      number: p.number,
      kind: p.kind,
      status: p.status,
      organizationId: hit?.org.id ?? null,
      locationId: hit?.loc.id ?? null,
      preparedFor: p.preparedFor,
      addressLine1: p.addressLine1,
      city: p.city,
      state: p.state,
      postalCode: p.postalCode,
      date: dateFromKey(p.date),
      scopeTitle: p.scopeTitle,
      scopeSubtitle: p.scopeSubtitle ?? null,
      intro: p.intro ?? null,
      note: p.note ?? null,
      priceNote: p.priceNote ?? null,
      totalCents: p.totalCents ?? 0,
      sentAt: p.status === "SENT" ? dateFromKey(p.date) : null,
      legacySource: p.source,
      createdById: actor.userId,
      sections: {
        create: p.sections.map((s, n) => ({
          title: s.title,
          subtotalLabel: s.subtotalLabel,
          sortOrder: n,
          lines: { create: s.lines.map((l, k) => ({ kind: l.kind as LineItemKind, description: l.description, quantity: new Prisma.Decimal(l.quantity), unitPriceCents: new Prisma.Decimal(l.unitPriceCents), amountCents: l.amountCents, sortOrder: k })) },
        })),
      },
    },
  });
  if (p.status === "SENT") await storeProposalPdf(tx, created.id, actor.userId);
  await audit(tx, { actorId: actor.userId, action: "import.proposal", entityType: "Proposal", entityId: created.id, organizationId: created.organizationId, after: { number: p.number, source: p.source } });
  return `${p.number} (${p.preparedFor}) imported${p.status === "DRAFT" ? " as a draft — pricing not recorded" : ""}.`;
}

async function importReport(tx: Db, actor: Actor, r: ImportReport) {
  if (await tx.serviceReport.findUnique({ where: { number: r.number } })) return `Report ${r.number}: already in the portal.`;
  const hit = await findLocation(tx, r.location);
  const invoice = await tx.invoice.findUnique({ where: { invoiceNumber: r.invoice } });
  const created = await tx.serviceReport.create({
    data: {
      number: r.number,
      status: "FINAL",
      organizationId: hit?.org.id ?? null,
      locationId: hit?.loc.id ?? null,
      invoiceId: invoice?.id ?? null,
      preparedFor: r.preparedFor,
      addressLine1: r.addressLine1,
      city: r.city,
      state: r.state,
      postalCode: r.postalCode,
      serviceDate: dateFromKey(r.serviceDate),
      subject: r.subject,
      sections: r.sections as unknown as Prisma.InputJsonValue,
      closing: r.closing,
      finalizedAt: dateFromKey(r.serviceDate),
      legacySource: r.source,
      createdById: actor.userId,
    },
  });
  await storeReportPdf(tx, created.id, actor.userId);
  await audit(tx, { actorId: actor.userId, action: "import.report", entityType: "ServiceReport", entityId: created.id, organizationId: created.organizationId, after: { number: r.number, source: r.source } });
  return `Service report ${r.number} (${r.preparedFor}) imported.`;
}

/** One 90-day plan per location from its latest trap service: same price, next date as printed. */
export function planSeeds(today: string) {
  const latest = new Map<string, ImportInvoice>();
  for (const i of RECORDS.invoices) {
    if (!TRAP_TYPES.includes(i.serviceType) || !i.nextServiceDate) continue;
    const cur = latest.get(i.location);
    if (!cur || compareKeys(i.date, cur.date) >= 0) latest.set(i.location, i);
  }
  return [...latest.entries()].map(([location, i]) => {
    const base = i.lines.find((l) => ["PER_GALLON", "FLAT_RATE"].includes(l.kind));
    const overdue = compareKeys(i.nextServiceDate!, today) < 0;
    return {
      location,
      invoice: i.number,
      serviceType: i.serviceType as ServiceType,
      title: i.serviceTitle,
      assetType: (i.assetType ?? "GREASE_TRAP") as "GREASE_TRAP" | "GRIT_TRAP",
      gallons: i.gallons,
      perGallonCents: i.rate && base?.kind === "PER_GALLON" ? base.unitPriceCents : null,
      flatPriceCents: base?.kind === "FLAT_RATE" ? base.amountCents : null,
      dueDate: i.nextServiceDate!,
      firstDate: overdue ? today : i.nextServiceDate!,
      overdue,
    };
  });
}

async function importPlans(tx: Db, actor: Actor) {
  const today = todayKey(await companyTimeZone(tx));
  let created = 0;
  let overdue = 0;
  for (const s of planSeeds(today)) {
    const hit = await findLocation(tx, s.location);
    if (!hit) continue;
    if (await tx.servicePlan.findFirst({ where: { locationId: hit.loc.id, serviceType: s.serviceType, status: "ACTIVE" } })) continue;
    const asset = await tx.serviceAsset.create({
      data: {
        assetTag: await numbers.asset(tx),
        organizationId: hit.org.id,
        locationId: hit.loc.id,
        type: s.assetType,
        name: s.assetType === "GRIT_TRAP" ? "Grit trap" : "Grease trap",
        capacityGallons: s.gallons ?? 0,
        placement: "OUTDOOR",
        frequencyDays: 90,
        notes: `Added from invoice ${s.invoice}. ${s.gallons ? `${s.gallons.toLocaleString()} gal pumped last visit; ` : ""}confirm size and placement.`,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    const rule = await tx.recurrenceRule.create({ data: { unit: "DAY", interval: 90, anchor: "COMPLETION_DATE", anchorDate: dateFromKey(s.dueDate) } });
    const plan = await tx.servicePlan.create({
      data: {
        planNumber: await numbers.plan(tx),
        organizationId: hit.org.id,
        locationId: hit.loc.id,
        name: `${s.title} — every 90 days`,
        serviceType: s.serviceType,
        recurrenceRuleId: rule.id,
        nextServiceDate: dateFromKey(s.firstDate),
        pricingModel: s.perGallonCents ? "PER_GALLON" : "FLAT_RATE",
        perGallonCents: s.perGallonCents ? new Prisma.Decimal(s.perGallonCents) : null,
        flatPriceCents: s.perGallonCents ? null : s.flatPriceCents,
        specialInstructions: s.overdue ? `Service was due ${s.dueDate} (from your records).` : null,
        startDate: dateFromKey(s.firstDate),
        createdById: actor.userId,
        updatedById: actor.userId,
        assets: { create: { assetId: asset.id } },
      },
    });
    await materializePlan(tx, plan.id, actor.userId);
    created++;
    if (s.overdue) overdue++;
  }
  await audit(tx, { actorId: actor.userId, action: "import.plans", entityType: "Import", entityId: "records-2026", after: { created, overdue } });
  return [`${created} recurring 90-day service plans created${overdue ? `; ${overdue} were already past their next service date and are scheduled for today` : ""}.`];
}
