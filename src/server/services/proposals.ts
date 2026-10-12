import "server-only";
import { z } from "zod";
import { Prisma, type LineItemKind } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { lineAmountCents } from "@/domain/invoice-math";
import { manifestFeeCents } from "@/domain/document-lines";
import { dateFromKey, isDateKey } from "@/lib/dates";
import { parseDollarRateToCentsString } from "@/lib/money";
import { getSetting } from "./settings";
import { storeDocument } from "./documents";

const KINDS = ["SERVICE", "PER_GALLON", "FLAT_RATE", "MINIMUM_CHARGE", "EMERGENCY_SURCHARGE", "AFTER_HOURS", "ADDITIONAL_EQUIPMENT", "DISPOSAL_FEE", "MANIFEST_FEE", "DISCOUNT", "OTHER"] as const;

const sectionSchema = z.object({
  title: z.string().trim().max(160).optional(),
  subtotalLabel: z.string().trim().max(80).optional(),
  lines: z
    .array(
      z.object({
        kind: z.enum(KINDS),
        description: z.string().trim().min(1, "Describe each line.").max(300),
        quantity: z.string().trim().regex(/^\d+(\.\d{1,3})?$/, "Quantity up to 3 decimals"),
        unitPrice: z.string().trim(),
      }),
    )
    .max(40),
});

const optUuid = z.string().uuid().optional().or(z.literal("").transform(() => undefined));

export const proposalSchema = z.object({
  kind: z.enum(["PROPOSAL", "QUOTE"]).default("PROPOSAL"),
  organizationId: optUuid,
  locationId: optUuid,
  preparedFor: z.string().trim().min(2, "Who is this for?").max(200),
  addressLine1: z.string().trim().min(3, "Enter the address.").max(200),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().length(2).toUpperCase(),
  postalCode: z.string().trim().max(10),
  date: z.string().refine(isDateKey, "Enter a valid date."),
  scopeTitle: z.string().trim().min(2, "Describe the scope.").max(160),
  scopeSubtitle: z.string().trim().max(160).optional(),
  intro: z.string().trim().max(2000).optional(),
  note: z.string().trim().max(3000).optional(),
  priceNote: z.string().trim().max(120).optional(),
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
    .pipe(z.array(sectionSchema).min(1).max(10)),
});
export type ProposalInput = z.infer<typeof proposalSchema>;
type SectionInput = z.infer<typeof sectionSchema>;

/** Prices each section; manifest fee lines are always the configured % of that section's trap service. */
export function priceSections(sections: SectionInput[], manifestFeeBps: number) {
  return sections.map((s) => {
    const lines = s.lines.map((l, i) => {
      const unit = parseDollarRateToCentsString(l.unitPrice.replace(/^-/, "")) ?? (l.kind === "MANIFEST_FEE" ? "0" : null);
      if (unit === null) throw badRequest(`"${l.description}": enter a price such as 225.00 or 0.42`);
      const signed = l.kind === "DISCOUNT" ? `-${unit}` : unit;
      return { kind: l.kind as LineItemKind, description: l.description, quantity: l.quantity, unitPriceCents: signed, amountCents: l.kind === "DISCOUNT" ? -lineAmountCents(l.quantity, unit) : lineAmountCents(l.quantity, unit), sortOrder: i };
    });
    const fee = manifestFeeCents(lines, manifestFeeBps);
    const priced = lines.map((l) => (l.kind === "MANIFEST_FEE" ? { ...l, quantity: "1", unitPriceCents: String(fee), amountCents: fee } : l));
    return { title: s.title || null, subtotalLabel: s.subtotalLabel || null, lines: priced, subtotalCents: priced.reduce((t, l) => t + l.amountCents, 0) };
  });
}

async function assertParty(db: Db, input: ProposalInput) {
  if (input.organizationId && !(await db.organization.findFirst({ where: { id: input.organizationId, deletedAt: null } }))) throw badRequest("Customer not found.");
  if (input.locationId && !(await db.serviceLocation.findFirst({ where: { id: input.locationId, ...(input.organizationId ? { organizationId: input.organizationId } : {}) } }))) throw badRequest("Location does not belong to this customer.");
}

function fields(input: ProposalInput) {
  return {
    kind: input.kind,
    organizationId: input.organizationId ?? null,
    locationId: input.locationId ?? null,
    preparedFor: input.preparedFor,
    addressLine1: input.addressLine1,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    date: dateFromKey(input.date),
    scopeTitle: input.scopeTitle,
    scopeSubtitle: input.scopeSubtitle || null,
    intro: input.intro || null,
    note: input.note || null,
    priceNote: input.priceNote || null,
  };
}

async function writeSections(db: Db, proposalId: string, sections: ReturnType<typeof priceSections>) {
  await db.proposalSection.deleteMany({ where: { proposalId } });
  for (const [i, s] of sections.entries()) {
    await db.proposalSection.create({
      data: {
        proposalId,
        title: s.title,
        subtotalLabel: s.subtotalLabel,
        sortOrder: i,
        lines: { create: s.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: new Prisma.Decimal(l.quantity), unitPriceCents: new Prisma.Decimal(l.unitPriceCents), amountCents: l.amountCents, sortOrder: l.sortOrder })) },
      },
    });
  }
  return Math.max(0, sections.reduce((t, s) => t + s.subtotalCents, 0));
}

export async function createProposal(actor: Actor, input: ProposalInput) {
  assertStaffActor(actor, "invoices.write");
  return prisma.$transaction(async (tx) => {
    await assertParty(tx, input);
    const sections = priceSections(input.sections, (await getSetting("billing", tx)).manifestFeeBps);
    const p = await tx.proposal.create({ data: { ...fields(input), number: input.kind === "QUOTE" ? await numbers.quote(tx) : await numbers.proposal(tx), createdById: actor.userId } });
    const totalCents = await writeSections(tx, p.id, sections);
    const saved = await tx.proposal.update({ where: { id: p.id }, data: { totalCents } });
    await audit(tx, { actorId: actor.userId, action: "proposal.create", entityType: "Proposal", entityId: p.id, organizationId: input.organizationId ?? null, after: { ...input, totalCents } });
    return saved;
  });
}

export async function updateProposal(actor: Actor, id: string, input: ProposalInput) {
  assertStaffActor(actor, "invoices.write");
  return prisma.$transaction(async (tx) => {
    const before = await tx.proposal.findUnique({ where: { id } });
    if (!before) throw notFound();
    if (before.status === "ACCEPTED" || before.status === "DECLINED") throw badRequest("This proposal is closed. Create a new one instead.");
    if (before.kind !== input.kind) throw badRequest("A proposal can't be changed into a quote (or back). Create a new one.");
    await assertParty(tx, input);
    const sections = priceSections(input.sections, (await getSetting("billing", tx)).manifestFeeBps);
    await tx.proposal.update({ where: { id }, data: fields(input) });
    const totalCents = await writeSections(tx, id, sections);
    const saved = await tx.proposal.update({ where: { id }, data: { totalCents } });
    if (before.status === "SENT") await storeProposalPdf(tx, id, actor.userId);
    await audit(tx, { actorId: actor.userId, action: "proposal.update", entityType: "Proposal", entityId: id, organizationId: saved.organizationId, before: { totalCents: before.totalCents }, after: { ...input, totalCents } });
    return saved;
  });
}

export const proposalStatusSchema = z.object({ proposalId: z.string().uuid(), status: z.enum(["SENT", "ACCEPTED", "DECLINED", "DRAFT"]), note: z.string().trim().max(1000).optional() });

/** SENT files the PDF (visible to the customer when the proposal is for an existing customer). */
export async function setProposalStatus(actor: Actor, input: z.infer<typeof proposalStatusSchema>) {
  assertStaffActor(actor, "invoices.write");
  return prisma.$transaction(async (tx) => {
    const p = await tx.proposal.findUnique({ where: { id: input.proposalId } });
    if (!p) throw notFound();
    const data: Prisma.ProposalUpdateInput =
      input.status === "SENT" ? { status: "SENT", sentAt: p.sentAt ?? new Date() } : input.status === "DRAFT" ? { status: "DRAFT", decidedAt: null, decisionNote: null } : { status: input.status, decidedAt: new Date(), decisionNote: input.note || null };
    const saved = await tx.proposal.update({ where: { id: p.id }, data });
    if (input.status === "SENT") await storeProposalPdf(tx, p.id, actor.userId);
    await audit(tx, { actorId: actor.userId, action: `proposal.${input.status.toLowerCase()}`, entityType: "Proposal", entityId: p.id, organizationId: p.organizationId, before: { status: p.status }, after: input });
    return saved;
  });
}

export async function storeProposalPdf(db: Db, proposalId: string, actorId: string | null) {
  const { renderProposalPdf } = await import("../pdf/proposal-pdf");
  const p = await db.proposal.findUniqueOrThrow({ where: { id: proposalId } });
  const bytes = await renderProposalPdf(db, proposalId);
  await db.document.updateMany({ where: { proposalId, type: "PROPOSAL", deletedAt: null }, data: { visibility: "INTERNAL", deletedAt: new Date() } });
  return storeDocument(db, {
    bytes,
    fileName: `${p.number}.pdf`,
    title: `${p.kind === "QUOTE" ? "Quote" : "Proposal"} ${p.number} — ${p.preparedFor}`,
    type: "PROPOSAL",
    visibility: p.organizationId ? "CUSTOMER" : "INTERNAL",
    organizationId: p.organizationId,
    locationId: p.locationId,
    proposalId: p.id,
    uploadedById: actorId,
    trusted: { mime: "application/pdf", ext: "pdf" },
  });
}

export const defaultProposalNote = (manifestFeeBps: number) =>
  `A ${manifestFeeBps / 100}% manifest fee applies to the trap service. All waste is disposed of in full compliance with TCEQ regulations. This proposal is valid for 30 days from the date above. We recommend recurring service every 90 days to keep your system compliant and clog-free.`;
