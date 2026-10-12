"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import * as inv from "@/server/services/invoices";
import { recordManualPayment, refundPayment } from "@/server/services/payments";
import { correctManifest, finalizeManifest, uploadOfficialManifest } from "@/server/services/manifests";
import { addDocumentVersion, archiveDocument, readUploadedFile, storeDocument } from "@/server/services/documents";
import { processDueDeliveries } from "@/server/services/notifications";
import { badRequest } from "@/server/errors";
import { parseDollarsToCents } from "@/lib/money";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";

const id = z.string().uuid();
const flush = () => after(() => processDueDeliveries());

/** Line items arrive as parallel arrays: kind[], description[], quantity[], unitPrice[], taxable[] (index-aligned). */
function linesFrom(fd: FormData) {
  const kinds = fd.getAll("kind").map(String);
  const desc = fd.getAll("description").map(String);
  const qty = fd.getAll("quantity").map(String);
  const price = fd.getAll("unitPrice").map(String);
  const taxable = fd.getAll("taxable").map(String);
  return kinds.map((k, i) => ({ kind: k, description: desc[i] ?? "", quantity: qty[i] ?? "1", unitPrice: price[i] ?? "0", taxable: taxable[i] !== "no" })).filter((l) => l.description.trim() || l.unitPrice.trim() !== "0");
}

function invoiceInput(fd: FormData) {
  return inv.invoiceSchema.parse({
    organizationId: fd.get("organizationId"),
    serviceLocationId: fd.get("serviceLocationId") || undefined,
    billingProfileId: fd.get("billingProfileId") || undefined,
    serviceDate: fd.get("serviceDate") || undefined,
    paymentTermsDays: fd.get("paymentTermsDays") || undefined,
    poNumber: fd.get("poNumber") || undefined,
    serviceTitle: fd.get("serviceTitle") || undefined,
    nextServiceDate: fd.get("nextServiceDate") || undefined,
    notes: fd.get("notes") || undefined,
    lines: linesFrom(fd),
  });
}

export async function createInvoiceAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async () => inv.createInvoice(await assertStaff("invoices.write"), invoiceInput(fd)));
  if (res.ok) redirect(`/admin/invoices/${res.data!.id}?created=1`);
  return res;
}

export async function updateInvoiceAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  const res = await runAction(async () => inv.updateDraftInvoice(await assertStaff("invoices.write"), String(fd.get("invoiceId")), invoiceInput(fd), String(fd.get("reason") || "") || undefined));
  return res.ok ? { ok: true, message: "Draft saved." } : res;
}

export async function sendInvoiceAction(invoiceId: string) {
  return runAction(async () => {
    await inv.sendInvoice(await assertStaff("invoices.write"), invoiceId);
    flush();
    return null;
  });
}

export async function generateInvoiceAction(jobId: string) {
  return runAction(async () => {
    const i = await inv.generateInvoiceForJob(await assertStaff("invoices.write"), jobId);
    return { id: i.id };
  });
}

export async function regenerateInvoicePdfAction(invoiceId: string) {
  return runAction(async () => {
    const actor = await assertStaff("invoices.write");
    await prisma.$transaction((tx) => inv.renderAndStoreInvoicePdf(tx, invoiceId, actor.userId));
    return null;
  });
}

const _void = formAction(z.object({ invoiceId: id, mode: z.enum(["void", "write_off"]), reason: z.string().trim().min(3, "Give a reason.") }), async (i) => {
  const actor = await assertStaff("invoices.void");
  if (i.mode === "void") await inv.voidInvoice(actor, i.invoiceId, i.reason);
  else await inv.writeOffInvoice(actor, i.invoiceId, i.reason);
  return { ok: true, message: i.mode === "void" ? "Invoice voided." : "Invoice written off." };
});
export async function voidInvoiceAction(p: ActionResult, fd: FormData) { return _void(p, fd); }

const _manual = formAction(z.object({ organizationId: id, method: z.enum(["CHECK", "CASH", "OTHER"]), amount: z.string(), reference: z.string().trim().max(80).optional(), invoiceIds: z.array(id).min(1, "Select at least one invoice."), notes: z.string().optional() }), async (i) => {
  const cents = parseDollarsToCents(i.amount);
  if (!cents || cents <= 0) throw badRequest("Enter a valid amount.");
  const p = await recordManualPayment(await assertStaff("payments.record"), { organizationId: i.organizationId, method: i.method, amountCents: cents, reference: i.reference, invoiceIds: i.invoiceIds, notes: i.notes });
  flush();
  redirect(`/admin/payments/${p.id}?recorded=1`);
});
export async function recordPaymentAction(p: ActionResult, fd: FormData) { return _manual(p, fd); }

const _refund = formAction(z.object({ paymentId: id, amount: z.string(), reason: z.string().trim().min(3) }), async (i) => {
  const cents = parseDollarsToCents(i.amount);
  if (!cents || cents <= 0) throw badRequest("Enter a valid amount.");
  const r = await refundPayment(await assertStaff("payments.refund"), i.paymentId, cents, i.reason);
  return { ok: true, message: r.pending ? "Refund submitted to Stripe. The balance updates when Stripe confirms it." : "Refund recorded." };
});
export async function refundPaymentAction(p: ActionResult, fd: FormData) { return _refund(p, fd); }

// ── Manifests ──
export async function finalizeManifestAction(manifestId: string) {
  return runAction(async () => {
    await finalizeManifest(await assertStaff("manifests.review"), manifestId);
    flush();
    return null;
  });
}

export async function correctManifestAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertStaff("manifests.review");
    const keys = fd.getAll("extraKey").map(String);
    const vals = fd.getAll("extraValue").map(String);
    const extra: Record<string, string> = {};
    keys.forEach((k, i) => {
      if (k.trim()) extra[k.trim().slice(0, 80)] = (vals[i] ?? "").slice(0, 500);
    });
    await correctManifest(actor, String(fd.get("manifestId")), { extra, reason: String(fd.get("reason") ?? "") });
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Revision created. Finalize it to publish to the customer." } : r));
}

export async function uploadOfficialManifestAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const file = await readUploadedFile(fd.get("file"));
    if (!file) throw badRequest("Choose a file.");
    await uploadOfficialManifest(await assertStaff("manifests.review"), String(fd.get("manifestId")), file, fd.get("visible") === "on");
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Official manifest uploaded." } : r));
}

export async function attachJobFilesAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const files = [];
    for (const entry of fd.getAll("files")) {
      const f = await readUploadedFile(entry);
      if (f) files.push(f);
    }
    const kind = z.enum(["BEFORE", "AFTER", "MANIFEST", "DOCUMENT"]).parse(fd.get("kind"));
    const { attachJobFiles } = await import("@/server/services/documents");
    const docs = await attachJobFiles(await assertStaff("documents.write"), z.string().uuid().parse(fd.get("jobId")), { kind, title: String(fd.get("title") ?? ""), visibleToCustomer: fd.get("visible") === "on" }, files);
    return docs.length;
  }).then((r) => (r.ok ? { ok: true, message: `${r.data} file${r.data === 1 ? "" : "s"} added to the job.` } : r));
}

// ── Documents ──
const DOC_TYPES = ["CONTRACT", "AGREEMENT", "PERMIT", "INSPECTION", "EQUIPMENT_PHOTO", "DISPOSAL_TICKET", "OTHER", "MANIFEST_OFFICIAL"] as const;
export async function uploadDocumentAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertStaff("documents.write");
    const input = z
      .object({ type: z.enum(DOC_TYPES), title: z.string().trim().min(2).max(200), organizationId: id.optional(), locationId: id.optional(), jobId: id.optional(), vehicleId: id.optional(), visibility: z.enum(["INTERNAL", "CUSTOMER"]) })
      .parse(Object.fromEntries([...fd.entries()].filter(([k, v]) => typeof v === "string" && v !== "" && k !== "file")));
    const file = await readUploadedFile(fd.get("file"));
    if (!file) throw badRequest("Choose a file.");
    if (input.locationId) {
      const loc = await prisma.serviceLocation.findUnique({ where: { id: input.locationId } });
      if (!loc || (input.organizationId && loc.organizationId !== input.organizationId)) throw badRequest("Location does not belong to this customer.");
      input.organizationId = loc.organizationId;
    }
    if (input.visibility === "CUSTOMER" && !input.organizationId) throw badRequest("Customer-visible documents must be linked to a customer.");
    await prisma.$transaction(async (tx) => {
      const doc = await storeDocument(tx, { ...input, bytes: file.bytes, fileName: file.name, uploadedById: actor.userId });
      await audit(tx, { actorId: actor.userId, action: "document.upload", entityType: "Document", entityId: doc.id, organizationId: input.organizationId ?? null, after: input });
    });
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Document uploaded." } : r));
}

export async function replaceDocumentAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const file = await readUploadedFile(fd.get("file"));
    if (!file) throw badRequest("Choose a file.");
    await addDocumentVersion(await assertStaff("documents.write"), String(fd.get("documentId")), file.bytes, file.name, String(fd.get("note") || "") || undefined);
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "New version uploaded. Previous versions are kept." } : r));
}

export async function archiveDocumentAction(documentId: string, reason: string) {
  return runAction(async () => archiveDocument(await assertStaff("documents.delete"), documentId, reason));
}

export async function setDocumentVisibilityAction(documentId: string, visibility: "INTERNAL" | "CUSTOMER") {
  return runAction(async () => {
    const actor = await assertStaff("documents.write");
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    if (visibility === "CUSTOMER" && !doc.organizationId) throw badRequest("Link the document to a customer first.");
    if (doc.type === "MANIFEST" && visibility === "CUSTOMER") {
      const m = doc.manifestId ? await prisma.manifest.findUnique({ where: { id: doc.manifestId } }) : null;
      if (m?.status !== "FINALIZED") throw badRequest("Only finalized manifests can be shared with customers.");
    }
    await prisma.$transaction(async (tx) => {
      await tx.document.update({ where: { id: documentId }, data: { visibility } });
      await audit(tx, { actorId: actor.userId, action: "document.visibility", entityType: "Document", entityId: documentId, organizationId: doc.organizationId, before: { visibility: doc.visibility }, after: { visibility } });
    });
  });
}

// ── Pricing rules ──
const _rule = formAction(
  z.object({ ruleId: id.optional().or(z.literal("").transform(() => undefined)), organizationId: id.optional().or(z.literal("").transform(() => undefined)), name: z.string().trim().min(2), kind: z.enum(["PER_GALLON", "FLAT_RATE", "MINIMUM_CHARGE", "EMERGENCY_SURCHARGE", "AFTER_HOURS", "ADDITIONAL_EQUIPMENT", "DISPOSAL_FEE"]), serviceType: z.string().optional(), amount: z.string().default("0"), percent: z.string().optional(), active: z.enum(["on"]).optional() }),
  async (i) => {
    const actor = await assertStaff(["settings.write", "invoices.write"]);
    const { parseDollarRateToCentsString } = await import("@/lib/money");
    const cents = parseDollarRateToCentsString(i.amount || "0");
    if (cents === null) throw badRequest("Enter an amount such as 0.32 or 175.00");
    const pct = i.percent ? Math.round(Number(i.percent) * 100) : null;
    if (i.percent && (!Number.isFinite(pct) || pct! < 0 || pct! > 50000)) throw badRequest("Enter a valid percentage.");
    const data = { organizationId: i.organizationId ?? null, name: i.name, kind: i.kind, serviceType: (i.serviceType || null) as never, amountCents: new Prisma.Decimal(cents), percentBps: pct, active: i.active === "on" };
    await prisma.$transaction(async (tx) => {
      const before = i.ruleId ? await tx.pricingRule.findUnique({ where: { id: i.ruleId } }) : null;
      const r = i.ruleId ? await tx.pricingRule.update({ where: { id: i.ruleId }, data }) : await tx.pricingRule.create({ data });
      await audit(tx, { actorId: actor.userId, action: i.ruleId ? "pricing.update" : "pricing.create", entityType: "PricingRule", entityId: r.id, organizationId: data.organizationId, before, after: data });
    });
    return { ok: true, message: "Pricing rule saved." };
  },
);
export async function savePricingRuleAction(p: ActionResult, fd: FormData) { return _rule(p, fd); }
