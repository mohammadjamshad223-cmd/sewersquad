import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, driver, job, expectCode, PNG, SIGNATURE } from "./helpers";
import { driverTransition } from "@/server/services/jobs";
import { saveServiceDraft, uploadJobPhoto, submitService, approveJob, uploadCityManifest } from "@/server/services/field";
import { createInvoice, sendInvoice, invoiceSchema } from "@/server/services/invoices";
import { createProposal, proposalSchema, setProposalStatus, priceSections } from "@/server/services/proposals";
import { createReport, finalizeReport, reportSchema } from "@/server/services/service-reports";
import { authorizeDocument } from "@/server/services/documents";
import { customer } from "./helpers";
import { addDays, keyFromDate } from "@/lib/dates";

describe("Sewer Squad paperwork", () => {
  let admin: Awaited<ReturnType<typeof staff>>, A: Awaited<ReturnType<typeof org>>, D: Awaited<ReturnType<typeof driver>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    admin = await staff("admin");
    A = await org("Ghost Bar", { locations: 2 });
    D = await driver(3000);
    await prisma.serviceLocation.update({ where: { id: A.locations[0]!.id }, data: { manifestFee: "CITY_OF_HOUSTON" } });
  });

  it("a City of Houston job: driver files the City manifest, invoice gets the 4% fee, title and next service date", async () => {
    const loc = A.locations[0]!;
    const j = await job(loc.id, { driverId: D.driver.id, vehicleId: D.vehicle.id, assetId: loc.asset.id });
    await driverTransition(D.actor, j.id, "EN_ROUTE");
    await driverTransition(D.actor, j.id, "ARRIVED");
    await saveServiceDraft(D.actor, j.id, { wasteType: "Grease trap waste", assets: [{ assetId: loc.asset.id, gallonsPumped: 800 }] });
    await uploadJobPhoto(D.actor, j.id, "BEFORE", { bytes: PNG, name: "b.png" });
    await uploadJobPhoto(D.actor, j.id, "AFTER", { bytes: PNG, name: "a.png" });
    const city = await uploadCityManifest(D.actor, j.id, { bytes: PNG, name: "coh.png" });
    await expectCode(uploadCityManifest(await (await driver()).actor, j.id, { bytes: PNG, name: "x.png" }), "NOT_FOUND");
    await submitService(D.actor, j.id, { customerSignerName: "Pat", customerSignature: SIGNATURE, driverSignature: SIGNATURE, certify: "on", customerUnavailable: false }, { ip: null });
    const res = await approveJob(admin, j.id);

    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId! }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } });
    expect(inv.lineItems.map((l) => [l.kind, l.description, l.amountCents])).toEqual([
      ["PER_GALLON", "Grease interceptor pumping & disposal", 24_000],
      ["MANIFEST_FEE", "City of Houston manifest fee", 960],
    ]);
    expect(inv.totalCents).toBe(24_960);
    expect(inv.serviceTitle).toBe("Grease Interceptor Pumping & Disposal");
    expect(keyFromDate(inv.nextServiceDate!)).toBe(addDays(keyFromDate(j.scheduledDate), 90));
    expect(inv.invoiceNumber).toMatch(/^\d{3}$/);

    const doc = await prisma.document.findUniqueOrThrow({ where: { id: city.id } });
    const manifest = await prisma.manifest.findUniqueOrThrow({ where: { jobId: j.id } });
    expect(doc.manifestId).toBe(manifest.id);
    expect(doc.visibility).toBe("CUSTOMER");
    expect(await prisma.document.count({ where: { manifestId: manifest.id, type: "MANIFEST", visibility: "CUSTOMER" } })).toBe(1);
  });

  it("a manual invoice gets a manifest generated and filed for the customer when sent", async () => {
    const loc = A.locations[1]!;
    const input = invoiceSchema.parse({ organizationId: A.org.id, serviceLocationId: loc.id, serviceTitle: "Grit Trap Pumping & Disposal", lines: [
      { kind: "PER_GALLON", description: "Grit trap pumping & disposal", quantity: "750", unitPrice: "0.89" },
      { kind: "OTHER", description: "Trench drain clearing", quantity: "1", unitPrice: "79.99" },
      { kind: "MANIFEST_FEE", description: "City of Houston manifest fee", quantity: "1", unitPrice: "999" },
    ] });
    const draft = await createInvoice(admin, input);
    expect(draft.totalCents).toBe(77_419); // fee recomputed: 4% of $667.50, not the $999 typed
    const sent = await sendInvoice(admin, draft.id);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: sent.id } });
    expect(inv.manifestRef).toBeTruthy();
    const m = await prisma.document.findFirstOrThrow({ where: { invoiceId: inv.id, type: "MANIFEST" } });
    expect(m.visibility).toBe("CUSTOMER");
    const owner = await customer(A.org.id, "ORG_ADMIN");
    await authorizeDocument(owner, m.id);
    await sendInvoice(admin, draft.id); // already sent: no second manifest
    expect(await prisma.document.count({ where: { invoiceId: inv.id, type: "MANIFEST" } })).toBe(1);
  });

  it("proposals price each section, file the PDF when sent, and prospects stay internal", async () => {
    expect(priceSections([{ title: "A", lines: [{ kind: "FLAT_RATE", description: "Grease", quantity: "1", unitPrice: "225" }, { kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0" }] }], 400)[0]!.subtotalCents).toBe(23_400);
    const base = { preparedFor: "Hollands Coffee & Anchor Hand Wash", addressLine1: "210 FM 1942", city: "Crosby", state: "TX", postalCode: "77532", date: "2026-08-21", scopeTitle: "Grease & Grit Trap Service" };
    const sections = JSON.stringify([
      { title: "HOLLANDS COFFEE — Grease Trap Service", subtotalLabel: "Hollands subtotal", lines: [{ kind: "FLAT_RATE", description: "Grease trap pumping & disposal", quantity: "1", unitPrice: "225" }, { kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0" }] },
      { title: "ANCHOR — Grit Trap Service", lines: [{ kind: "FLAT_RATE", description: "Grit trap pumping & disposal", quantity: "1", unitPrice: "249.99" }, { kind: "OTHER", description: "Trench drain cleaning", quantity: "3", unitPrice: "49.99" }, { kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0" }] },
    ]);
    const prospect = await createProposal(admin, proposalSchema.parse({ ...base, sections }));
    expect(prospect.totalCents).toBe(64_396);
    expect(prospect.number).toMatch(/^P-\d{3}$/);
    await setProposalStatus(admin, { proposalId: prospect.id, status: "SENT" });
    expect((await prisma.document.findFirstOrThrow({ where: { proposalId: prospect.id } })).visibility).toBe("INTERNAL");
    const quote = await createProposal(admin, proposalSchema.parse({ ...base, kind: "QUOTE", organizationId: A.org.id, locationId: A.locations[1]!.id, sections }));
    expect(quote.number).toMatch(/^Q-\d{3}$/);
    await setProposalStatus(admin, { proposalId: quote.id, status: "SENT" });
    expect((await prisma.document.findFirstOrThrow({ where: { proposalId: quote.id } })).visibility).toBe("CUSTOMER");
    await expectCode(createProposal(await staff("dispatcher"), proposalSchema.parse({ ...base, sections })), "FORBIDDEN");
  });

  it("service reports share the invoice number and are filed for the customer when finalized", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({ where: { organizationId: A.org.id, jobId: { not: null } } });
    const input = reportSchema.parse({ invoiceId: inv.id, preparedFor: "Ghost Bar", addressLine1: "5600 Richmond Ave", city: "Houston", state: "TX", postalCode: "77057", serviceDate: "2026-08-10", subject: "Sample Well & City Connection", sections: JSON.stringify([{ title: "Findings", body: "Clogged.\n\n• Jet the line\n• Camera if needed" }]) });
    const r = await createReport(admin, input);
    expect(r.number).toBe(inv.invoiceNumber);
    expect(r.organizationId).toBe(A.org.id);
    expect((await createReport(admin, input)).number).toMatch(/^R-\d{3}$/); // number already used
    await finalizeReport(admin, r.id);
    expect((await prisma.document.findFirstOrThrow({ where: { serviceReportId: r.id } })).visibility).toBe("CUSTOMER");
  });
});
