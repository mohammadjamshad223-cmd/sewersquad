import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, driver, job, expectCode, PNG, SIGNATURE, today } from "./helpers";
import { createPlan, materializePlan, advancePlan } from "@/server/services/plans";
import { cancelJob, rescheduleJob, driverTransition } from "@/server/services/jobs";
import { saveServiceDraft, uploadJobPhoto, submitService, approveJob, rejectJob } from "@/server/services/field";
import { correctManifest } from "@/server/services/manifests";
import { generateInvoiceForJob } from "@/server/services/invoices";
import { recordDisposal } from "@/server/services/disposal";
import { addDays, keyFromDate } from "@/lib/dates";

describe("recurring scheduling", () => {
  let admin: Awaited<ReturnType<typeof staff>>, A: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    admin = await staff("admin");
    A = await org("Plan Co", { locations: 1 });
  });

  const base = () => ({ locationId: A.locations[0]!.id, name: "Every 30 days", serviceType: "INTERCEPTOR_PUMPING" as const, assetIds: [A.locations[0]!.asset.id], unit: "DAY" as const, interval: 30, anchor: "FIXED_CALENDAR" as const, startDate: addDays(today(), 3), pricingModel: "PER_GALLON" as const, perGallonPrice: "0.30", preferredWindowStart: null, preferredWindowEnd: null });

  it("creating a plan schedules exactly one upcoming job, and re-materializing is idempotent", async () => {
    const plan = await createPlan(admin, base());
    expect(await prisma.job.count({ where: { planId: plan.id } })).toBe(1);
    await materializePlan(prisma, plan.id, null);
    await materializePlan(prisma, plan.id, null);
    await Promise.all([materializePlan(prisma, plan.id, null), materializePlan(prisma, plan.id, null)]);
    expect(await prisma.job.count({ where: { planId: plan.id } })).toBe(1);
    const j = await prisma.job.findFirstOrThrow({ where: { planId: plan.id } });
    expect(keyFromDate(j.scheduledDate)).toBe(addDays(today(), 3));
  });

  it("advancing twice for the same occurrence does not skip or duplicate", async () => {
    const plan = await createPlan(admin, { ...base(), name: "Idempotent" });
    const first = await prisma.job.findFirstOrThrow({ where: { planId: plan.id } });
    await advancePlan(prisma, first, keyFromDate(first.scheduledDate), null);
    await advancePlan(prisma, first, keyFromDate(first.scheduledDate), null);
    const p = await prisma.servicePlan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(keyFromDate(p.nextServiceDate!)).toBe(addDays(keyFromDate(first.occurrenceDate!), 30));
  });

  it("rescheduling keeps the contractual occurrence; cancelling skips to the next occurrence", async () => {
    const plan = await createPlan(admin, { ...base(), name: "Reschedule" });
    const j = await prisma.job.findFirstOrThrow({ where: { planId: plan.id } });
    await rescheduleJob(admin, j.id, { date: addDays(today(), 10), reason: "Customer closed" });
    const moved = await prisma.job.findUniqueOrThrow({ where: { id: j.id } });
    expect(keyFromDate(moved.scheduledDate)).toBe(addDays(today(), 10));
    expect(keyFromDate(moved.occurrenceDate!)).toBe(keyFromDate(j.occurrenceDate!));
    await cancelJob(admin, j.id, "Skipped this month");
    const next = await prisma.job.findFirst({ where: { planId: plan.id, status: { not: "CANCELLED" } } });
    // Next occurrence is 30 days after the skipped occurrence (fixed calendar) — outside horizon? default horizon 60 days.
    expect(next && keyFromDate(next.occurrenceDate!)).toBe(addDays(keyFromDate(j.occurrenceDate!), 30));
  });

  it("rejects rescheduling into the past and requires a reason", async () => {
    const j = await job(A.locations[0]!.id);
    await expectCode(rescheduleJob(admin, j.id, { date: addDays(today(), -1), reason: "x y z" }), "BAD_REQUEST");
    await expectCode(rescheduleJob(admin, j.id, { date: addDays(today(), 1), reason: "" }), "BAD_REQUEST");
  });
});

describe("field workflow → review → manifest → invoice", () => {
  let admin: Awaited<ReturnType<typeof staff>>, A: Awaited<ReturnType<typeof org>>, D: Awaited<ReturnType<typeof driver>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    admin = await staff("admin");
    A = await org("Field Co", { locations: 1 });
    D = await driver(1200);
  });

  async function performService() {
    const j = await job(A.locations[0]!.id, { driverId: D.driver.id, vehicleId: D.vehicle.id, assetId: A.locations[0]!.asset.id });
    await expectCode(driverTransition(D.actor, j.id, "ARRIVED"), "BAD_REQUEST"); // must go en route first
    await driverTransition(D.actor, j.id, "EN_ROUTE");
    await driverTransition(D.actor, j.id, "ARRIVED");
    await saveServiceDraft(D.actor, j.id, { wasteType: "Grease trap waste", assets: [{ assetId: A.locations[0]!.asset.id, gallonsPumped: 800 }] });
    return j;
  }

  it("submission is blocked until required documentation is present", async () => {
    const j = await performService();
    await expectCode(submitService(D.actor, j.id, { driverSignature: SIGNATURE, certify: "on", customerUnavailable: true, customerUnavailableReason: "Closed" }, { ip: null }), "BAD_REQUEST");
  });

  it("completes the workflow; finalized manifests are immutable and corrections create versions", async () => {
    const j = await performService();
    await uploadJobPhoto(D.actor, j.id, "BEFORE", { bytes: PNG, name: "before.png" });
    await uploadJobPhoto(D.actor, j.id, "AFTER", { bytes: PNG, name: "after.png" });
    await submitService(D.actor, j.id, { customerSignerName: "Pat Manager", customerSignature: SIGNATURE, driverSignature: SIGNATURE, certify: "on", customerUnavailable: false }, { ip: null });
    const submitted = await prisma.job.findUniqueOrThrow({ where: { id: j.id }, include: { manifest: true } });
    expect(submitted.status).toBe("SUBMITTED");
    expect(submitted.manifest?.status).toBe("PENDING_REVIEW");

    const res = await approveJob(admin, j.id);
    const m = await prisma.manifest.findUniqueOrThrow({ where: { jobId: j.id }, include: { versions: true } });
    expect(m.status).toBe("FINALIZED");
    const final = m.versions.find((v) => v.isFinal)!;
    expect(final.pdfDocumentId).toBeTruthy();

    // Database-level immutability.
    await expect(prisma.manifestVersion.update({ where: { id: final.id }, data: { reason: "tampered" } })).rejects.toThrow(/immutable/);
    await expect(prisma.manifestVersion.delete({ where: { id: final.id } })).rejects.toThrow(/cannot be deleted/);

    await correctManifest(admin, m.id, { reason: "Add county permit number", extra: { "County permit": "HC-123" } });
    const after = await prisma.manifest.findUniqueOrThrow({ where: { id: m.id }, include: { versions: { orderBy: { version: "asc" } } } });
    expect(after.versions.length).toBe(m.versions.length + 1);
    expect(after.status).toBe("PENDING_REVIEW");
    expect(after.versions.find((v) => v.id === final.id)!.data).toEqual(final.data); // original preserved
    expect(await prisma.auditLog.count({ where: { action: "manifest.correct", entityId: m.id } })).toBe(1);

    // Invoice was generated once; regenerating returns the same invoice.
    expect(res.invoiceId).toBeTruthy();
    const again = await generateInvoiceForJob(admin, j.id);
    expect(again.id).toBe(res.invoiceId);
    expect(await prisma.invoice.count({ where: { jobId: j.id } })).toBe(1);
    const inv = await prisma.invoice.findUniqueOrThrow({ where: { id: res.invoiceId! } });
    expect(inv.totalCents).toBe(800 * 30); // 800 gal × $0.30 company rule
  });

  it("a rejected submission returns to the driver and cannot be approved", async () => {
    const j = await performService();
    await uploadJobPhoto(D.actor, j.id, "BEFORE", { bytes: PNG, name: "b.png" });
    await uploadJobPhoto(D.actor, j.id, "AFTER", { bytes: PNG, name: "a.png" });
    await submitService(D.actor, j.id, { driverSignature: SIGNATURE, certify: "on", customerUnavailable: true, customerUnavailableReason: "After hours" }, { ip: null });
    await rejectJob(admin, j.id, "Gallons look wrong — re-check the meter");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("PENDING_DOCUMENTATION");
    await expectCode(approveJob(admin, j.id), "BAD_REQUEST");
    const sigs = await prisma.manifestSignature.findMany({ where: { manifest: { jobId: j.id }, role: "CUSTOMER" } });
    expect(sigs[0]!.unavailable).toBe(true);
    expect(sigs[0]!.signatureDocumentId).toBeNull(); // never fabricated
  });

  it("a load can only be allocated to one disposal event", async () => {
    const j = await job(A.locations[0]!.id, { driverId: D.driver.id, vehicleId: D.vehicle.id });
    await prisma.job.update({ where: { id: j.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const fac = await prisma.disposalFacility.create({ data: { name: "Plant", addressLine1: "1 Rd", city: "Houston", postalCode: "77002" } });
    const input = { vehicleId: D.vehicle.id, facilityId: fac.id, disposedAt: new Date().toISOString(), wasteType: "Grease trap waste", gallons: 100, ratePerGallon: "0.06", adjustmentGallons: 0, facilityAcknowledged: false, jobIds: [j.id] };
    const e = await recordDisposal(D.actor, input, null);
    expect(e.totalCostCents).toBe(600);
    await expectCode(recordDisposal(D.actor, input, null), "BAD_REQUEST");
  });
});
