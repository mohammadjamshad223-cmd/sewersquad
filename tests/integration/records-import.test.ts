import { writeFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, expectCode } from "./helpers";
import { RECORDS, runImportStep, importPreview, type ImportStep, type ImportOptions } from "@/server/services/records-import";
import { renderInvoicePdf } from "@/server/pdf/invoice-pdf";
import { renderProposalPdf } from "@/server/pdf/proposal-pdf";
import { renderReportPdf } from "@/server/pdf/report-pdf";
import { getSetting } from "@/server/services/settings";
import type { Actor } from "@/server/auth/session";

async function runAll(actor: Actor, opts: ImportOptions) {
  let step: ImportStep = { phase: "company", cursor: 0 };
  const log: string[] = [];
  for (let guard = 0; step.phase !== "done" && guard < 50; guard++) {
    const r = await runImportStep(actor, opts, step);
    log.push(...r.log);
    step = r.next;
  }
  return log;
}

describe("historical records import", () => {
  let owner: Actor;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    owner = await staff("super_admin");
  }, 120_000);

  it("needs settings permission", async () => {
    await expectCode(runImportStep(await staff("dispatcher"), { unpaid: [], applyCompany: true, createPlans: true }, { phase: "company", cursor: 0 }), "FORBIDDEN");
  });

  it("imports customers, invoices, proposals, reports and plans, and is safe to re-run", async () => {
    const unpaid = ["050", "072"];
    await runAll(owner, { unpaid, applyCompany: true, createPlans: true });
    await runAll(owner, { unpaid, applyCompany: true, createPlans: true }); // idempotent

    expect(await prisma.organization.count()).toBe(RECORDS.organizations.length);
    expect(await prisma.serviceLocation.count()).toBe(65);
    const invoices = await prisma.invoice.findMany({ include: { lineItems: true } });
    expect(invoices).toHaveLength(72);
    const byNo = new Map(invoices.map((i) => [i.invoiceNumber, i]));
    for (const r of RECORDS.invoices) if (r.totalCents !== null) expect(byNo.get(r.number)!.totalCents).toBe(r.totalCents);
    expect(byNo.get("001")!.status).toBe("DRAFT");
    expect(byNo.get("050")!.status).toBe("SENT");
    expect(byNo.get("050")!.balanceCents).toBe(77_419);
    expect(byNo.get("049")!.status).toBe("PAID");
    expect(await prisma.payment.count({ where: { status: "SUCCEEDED" } })).toBe(72 - 1 - unpaid.length);
    expect(await prisma.document.count({ where: { type: "INVOICE", deletedAt: null } })).toBe(71);

    const p054 = await prisma.proposal.findUniqueOrThrow({ where: { number: "P-054" } });
    expect(p054.totalCents).toBe(64_396);
    expect(p054.organizationId).toBeTruthy();
    expect(await prisma.proposal.count()).toBe(6);
    const r040 = await prisma.serviceReport.findUniqueOrThrow({ where: { number: "040" } });
    expect(r040.invoiceId).toBe(byNo.get("040")!.id);
    expect(await prisma.document.count({ where: { type: "SERVICE_REPORT", visibility: "CUSTOMER" } })).toBe(2);

    const plans = await prisma.servicePlan.findMany({ include: { recurrenceRule: true } });
    expect(plans.length).toBeGreaterThan(50);
    expect(plans.every((p) => p.recurrenceRule.interval === 90 && p.recurrenceRule.unit === "DAY")).toBe(true);
    expect(new Set(plans.map((p) => p.locationId)).size).toBe(plans.length);

    const hauler = await getSetting("hauler");
    expect(hauler.tceqNumber).toBe("26967");
    expect(hauler.cityOfHoustonNumber).toBe("");
    expect((await getSetting("company")).name).toBe("Sewer Squad Services LLC");

    const preview = await importPreview();
    expect(preview.invoices.every((i) => i.imported)).toBe(true);

    // Sample documents in the owner's template, for visual review.
    const out = process.env.PDF_OUT;
    const pdfs = [await renderInvoicePdf(prisma, byNo.get("050")!.id), await renderProposalPdf(prisma, p054.id), await renderReportPdf(prisma, r040.id)];
    for (const b of pdfs) expect(Buffer.from(b).subarray(0, 5).toString()).toBe("%PDF-");
    if (out) ["invoice-050", "proposal-P-054", "report-040"].forEach((n, i) => writeFileSync(`${out}/${n}.pdf`, pdfs[i]!));
  }, 300_000);
});
