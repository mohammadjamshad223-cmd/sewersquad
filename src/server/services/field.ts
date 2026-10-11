import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import type { Actor } from "../auth/session";
import { assertDriverActor, assertStaffActor } from "../authz/check";
import { DRIVER_EDITABLE_STATUSES, assertTransition, type JobStatus } from "@/domain/job-state";
import { instantToDateKey, keyFromDate } from "@/lib/dates";
import { storeDocument } from "./documents";
import { ensureManifest, finalizeManifest, rejectManifest, writeSubmittedVersion } from "./manifests";
import { advancePlan } from "./plans";
import { syncEmergencyForJob } from "./jobs";
import { customerRecipientsForLocation, notify, staffWithPermission } from "./notifications";
import { companyTimeZone, getSetting } from "./settings";
import { parseDollarRateToCentsString } from "@/lib/money";
import { numbers } from "../numbering";

export const serviceDraftSchema = z.object({
  conditionBefore: z.string().trim().max(2000).optional().nullable(),
  accessIssues: z.string().trim().max(2000).optional().nullable(),
  unusualConditions: z.string().trim().max(2000).optional().nullable(),
  conditionAfter: z.string().trim().max(2000).optional().nullable(),
  issuesFound: z.string().trim().max(2000).optional().nullable(),
  followUpRecommendations: z.string().trim().max(2000).optional().nullable(),
  additionalWork: z.string().trim().max(2000).optional().nullable(),
  wasteType: z.string().trim().max(120).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  startedAt: z.string().datetime().optional().nullable(),
  finishedAt: z.string().datetime().optional().nullable(),
  assets: z
    .array(
      z.object({
        assetId: z.string().uuid(),
        gallonsPumped: z.coerce.number().int("Whole gallons only").min(0).max(100_000),
        wasteType: z.string().trim().max(120).optional().nullable(),
        servicePerformed: z.string().trim().max(500).optional().nullable(),
        conditionBefore: z.string().trim().max(1000).optional().nullable(),
        conditionAfter: z.string().trim().max(1000).optional().nullable(),
        notes: z.string().trim().max(1000).optional().nullable(),
      }),
    )
    .max(50)
    .default([]),
  clientVersion: z.coerce.number().int().min(0).optional(),
});

export type ServiceDraft = z.infer<typeof serviceDraftSchema>;

async function driverJobForEdit(db: Db, actor: Actor, jobId: string) {
  const driver = assertDriverActor(actor);
  const job = await db.job.findFirst({ where: { id: jobId, driverId: driver.driverId }, include: { assets: true, serviceRecord: true } });
  if (!job) throw notFound();
  if (!DRIVER_EDITABLE_STATUSES.includes(job.status as JobStatus)) throw badRequest("This job is not open for documentation. Mark yourself as arrived first.");
  return { job, driverId: driver.driverId };
}

/**
 * Save the driver's in-progress documentation. Last-write-wins with a monotonically increasing
 * clientDraftVersion so an older offline draft cannot silently overwrite newer server data.
 */
export async function saveServiceDraft(actor: Actor, jobId: string, draft: ServiceDraft) {
  return prisma.$transaction(async (tx) => {
    const { job, driverId } = await driverJobForEdit(tx, actor, jobId);
    const current = job.serviceRecord?.clientDraftVersion ?? 0;
    if (draft.clientVersion !== undefined && draft.clientVersion < current) {
      throw conflict("A newer version of this job's documentation was saved from another device. Reload to continue.");
    }
    const allowedAssets = new Set(job.assets.map((a) => a.assetId));
    // Drivers may also document other active equipment at the same location.
    const extra = draft.assets.filter((a) => !allowedAssets.has(a.assetId)).map((a) => a.assetId);
    if (extra.length) {
      const ok = await tx.serviceAsset.count({ where: { id: { in: extra }, locationId: job.locationId, deletedAt: null } });
      if (ok !== extra.length) throw badRequest("Equipment must belong to this location.");
    }
    const { assets, clientVersion: _cv, startedAt, finishedAt, ...fields } = draft;
    void _cv;
    const record = await tx.serviceRecord.upsert({
      where: { jobId },
      create: { jobId, driverId, vehicleId: job.vehicleId, ...fields, startedAt: startedAt ? new Date(startedAt) : null, finishedAt: finishedAt ? new Date(finishedAt) : null, clientDraftVersion: current + 1 },
      update: { ...fields, ...(startedAt ? { startedAt: new Date(startedAt) } : {}), ...(finishedAt ? { finishedAt: new Date(finishedAt) } : {}), clientDraftVersion: current + 1 },
    });
    const assetRows = await tx.serviceAsset.findMany({ where: { id: { in: assets.map((a) => a.assetId) } } });
    await tx.serviceAssetRecord.deleteMany({ where: { serviceRecordId: record.id, assetId: { notIn: assets.map((a) => a.assetId) } } });
    for (const a of assets) {
      const asset = assetRows.find((r) => r.id === a.assetId)!;
      const data = {
        capacityGallons: asset.capacityGallons,
        gallonsPumped: a.gallonsPumped,
        wasteType: a.wasteType || fields.wasteType || "Grease trap waste",
        servicePerformed: a.servicePerformed ?? null,
        conditionBefore: a.conditionBefore ?? null,
        conditionAfter: a.conditionAfter ?? null,
        notes: a.notes ?? null,
      };
      await tx.serviceAssetRecord.upsert({ where: { serviceRecordId_assetId: { serviceRecordId: record.id, assetId: a.assetId } }, create: { serviceRecordId: record.id, assetId: a.assetId, ...data }, update: data });
    }
    if (assets.length > 0 && (job.status === "ARRIVED" || job.status === "IN_PROGRESS")) {
      // Pumping recorded: advance ARRIVED → IN_PROGRESS → PENDING_DOCUMENTATION.
      if (job.status === "ARRIVED") {
        assertTransition("ARRIVED", "IN_PROGRESS", "driver");
        await tx.jobStatusEvent.create({ data: { jobId, fromStatus: "ARRIVED", toStatus: "IN_PROGRESS", actorId: actor.userId } });
        if (!record.startedAt) await tx.serviceRecord.update({ where: { id: record.id }, data: { startedAt: new Date() } });
      }
      assertTransition("IN_PROGRESS", "PENDING_DOCUMENTATION", "driver");
      await tx.job.update({ where: { id: jobId }, data: { status: "PENDING_DOCUMENTATION" } });
      await tx.jobStatusEvent.create({ data: { jobId, fromStatus: "IN_PROGRESS", toStatus: "PENDING_DOCUMENTATION", actorId: actor.userId } });
    }
    return { clientVersion: current + 1 };
  });
}

export async function uploadJobPhoto(actor: Actor, jobId: string, phase: "BEFORE" | "AFTER" | "ISSUE", file: { bytes: Uint8Array; name: string }, assetId?: string | null) {
  const { job } = await driverJobForEdit(prisma, actor, jobId);
  return prisma.$transaction((tx) =>
    storeDocument(tx, {
      bytes: file.bytes,
      fileName: file.name,
      title: `${phase === "BEFORE" ? "Before" : phase === "AFTER" ? "After" : "Issue"} photo — ${job.jobNumber}`,
      type: "SERVICE_PHOTO",
      photoPhase: phase,
      organizationId: job.organizationId,
      locationId: job.locationId,
      jobId,
      assetId: assetId ?? null,
      uploadedById: actor.userId,
      imagesOnly: true,
    }),
  );
}

export async function deleteJobPhoto(actor: Actor, jobId: string, documentId: string) {
  await driverJobForEdit(prisma, actor, jobId);
  const doc = await prisma.document.findFirst({ where: { id: documentId, jobId, type: "SERVICE_PHOTO", uploadedById: actor.userId, deletedAt: null } });
  if (!doc) throw notFound();
  await prisma.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
}

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

function decodeSignature(dataUrl: string): Uint8Array {
  const m = PNG_DATA_URL.exec(dataUrl);
  if (!m) throw badRequest("Signature must be captured on the signature pad.");
  const bytes = new Uint8Array(Buffer.from(m[1]!, "base64"));
  if (bytes.byteLength < 200) throw badRequest("Signature appears to be empty.");
  if (bytes.byteLength > 600_000) throw badRequest("Signature image is too large.");
  return bytes;
}

export const submitSchema = z
  .object({
    customerSignerName: z.string().trim().max(120).optional(),
    customerSignerTitle: z.string().trim().max(120).optional(),
    customerSignature: z.string().optional(),
    customerUnavailable: z.coerce.boolean().optional().default(false),
    customerUnavailableReason: z.string().trim().max(500).optional(),
    driverSignature: z.string().min(1, "Driver signature is required."),
    certify: z.literal("on", { errorMap: () => ({ message: "You must certify the information is accurate." }) }),
  })
  .superRefine((v, ctx) => {
    if (v.customerUnavailable) {
      if (!v.customerUnavailableReason || v.customerUnavailableReason.length < 3) ctx.addIssue({ code: "custom", path: ["customerUnavailableReason"], message: "Explain why no representative could sign." });
    } else {
      if (!v.customerSignerName || v.customerSignerName.length < 2) ctx.addIssue({ code: "custom", path: ["customerSignerName"], message: "Enter the representative's name." });
      if (!v.customerSignature) ctx.addIssue({ code: "custom", path: ["customerSignature"], message: "Customer signature is required, or mark the representative as unavailable." });
    }
  });

/** Completeness checks before a driver may submit. Returns human-readable problems. */
export async function submissionProblems(db: Db, jobId: string): Promise<string[]> {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { serviceRecord: { include: { assetRecords: true } }, documents: { where: { deletedAt: null, type: "SERVICE_PHOTO" } } } });
  const problems: string[] = [];
  const rec = job.serviceRecord;
  if (!rec) return ["No service record has been started."];
  if (rec.assetRecords.length === 0) problems.push("Record gallons pumped for at least one piece of equipment.");
  if (!rec.wasteType && rec.assetRecords.some((a) => !a.wasteType)) problems.push("Select the waste type.");
  if (!job.documents.some((d) => d.photoPhase === "BEFORE")) problems.push("Add at least one before-service photo.");
  if (!job.documents.some((d) => d.photoPhase === "AFTER")) problems.push("Add at least one after-service photo.");
  return problems;
}

export async function submitService(actor: Actor, jobId: string, input: z.infer<typeof submitSchema>, meta: { ip?: string | null }) {
  const driver = assertDriverActor(actor);
  const tz = await companyTimeZone();
  return prisma.$transaction(
    async (tx) => {
      const job = await tx.job.findFirst({ where: { id: jobId, driverId: driver.driverId }, include: { location: true, serviceRecord: true } });
      if (!job) throw notFound();
      if (!["IN_PROGRESS", "PENDING_DOCUMENTATION"].includes(job.status)) throw badRequest("This job is not ready to submit.");
      const problems = await submissionProblems(tx, jobId);
      if (problems.length) throw badRequest(problems.join(" "));

      const manifest = await ensureManifest(tx, jobId);
      const sign = async (role: "CUSTOMER" | "DRIVER", dataUrl: string | undefined, signerName: string, signerTitle: string | null, unavailable = false, reason: string | null = null) => {
        let docId: string | null = null;
        if (dataUrl && !unavailable) {
          const doc = await storeDocument(tx, {
            bytes: decodeSignature(dataUrl),
            fileName: `${role.toLowerCase()}-signature.png`,
            title: `${role === "CUSTOMER" ? "Customer" : "Driver"} signature — ${manifest.manifestNumber}`,
            type: "SIGNATURE",
            organizationId: job.organizationId,
            locationId: job.locationId,
            jobId,
            manifestId: manifest.id,
            uploadedById: actor.userId,
            trusted: { mime: "image/png", ext: "png" },
          });
          docId = doc.id;
        }
        await tx.manifestSignature.create({
          data: { manifestId: manifest.id, role, signerName, signerTitle, signerUserId: role === "DRIVER" ? actor.userId : null, signatureDocumentId: docId, unavailable, unavailableReason: reason, ipAddress: meta.ip ?? null },
        });
      };
      await sign("CUSTOMER", input.customerSignature, input.customerUnavailable ? "" : input.customerSignerName!, input.customerSignerTitle ?? null, input.customerUnavailable, input.customerUnavailable ? input.customerUnavailableReason! : null);
      await sign("DRIVER", input.driverSignature, actor.name, "Driver");

      const now = new Date();
      await tx.serviceRecord.update({ where: { jobId }, data: { finishedAt: job.serviceRecord?.finishedAt ?? now, submittedAt: now, reviewStatus: "SUBMITTED" } });
      if (job.status === "IN_PROGRESS") {
        await tx.jobStatusEvent.create({ data: { jobId, fromStatus: "IN_PROGRESS", toStatus: "PENDING_DOCUMENTATION", actorId: actor.userId } });
      }
      assertTransition("PENDING_DOCUMENTATION", "SUBMITTED", "driver");
      const moved = await tx.job.updateMany({ where: { id: jobId, status: job.status }, data: { status: "SUBMITTED", completedAt: now } });
      if (moved.count !== 1) throw conflict("This job was updated elsewhere. Refresh and try again.");
      await tx.jobStatusEvent.create({ data: { jobId, fromStatus: "PENDING_DOCUMENTATION", toStatus: "SUBMITTED", actorId: actor.userId, note: input.customerUnavailable ? `Customer representative unavailable: ${input.customerUnavailableReason}` : null } });

      // Asset service dates.
      const recs = await tx.serviceAssetRecord.findMany({ where: { serviceRecord: { jobId } } });
      await tx.serviceAsset.updateMany({ where: { id: { in: recs.map((r) => r.assetId) } }, data: { lastServicedAt: now } });

      await writeSubmittedVersion(tx, manifest.id, actor.userId);
      await syncEmergencyForJob(tx, jobId, "SUBMITTED", actor.userId);
      // The service has physically been performed: schedule the next occurrence now.
      await advancePlan(tx, job, instantToDateKey(now, tz), actor.userId);

      await audit(tx, { actorId: actor.userId, action: "job.submit", entityType: "Job", entityId: jobId, organizationId: job.organizationId, after: { manifestId: manifest.id, customerUnavailable: input.customerUnavailable } });

      await notify(tx, {
        userIds: await staffWithPermission(tx, "jobs.approve"),
        type: "admin.job_submitted",
        title: `Review needed: ${job.jobNumber}`,
        body: `${actor.name} submitted ${job.location.name}. Documentation is awaiting approval.`,
        link: `/admin/jobs/${jobId}`,
        entityType: "Job",
        entityId: jobId,
        dedupeKey: `job:${jobId}:submitted:${now.getTime()}`,
      });
      await notify(tx, {
        userIds: await customerRecipientsForLocation(tx, job.organizationId, job.locationId),
        type: "service.completed",
        title: `Service completed at ${job.location.name}`,
        body: `Your service visit (${job.jobNumber}) is complete. Your manifest will be available once our office has reviewed the documentation.`,
        link: `/customer/services/${jobId}`,
        entityType: "Job",
        entityId: jobId,
        dedupeKey: `job:${jobId}:completed`,
      });
    },
    { timeout: 30_000 },
  );
}

export async function addJobCharge(actor: Actor, jobId: string, input: { kind: string; description: string; quantity: string; unitPrice: string }) {
  const { job } = await driverJobForEdit(prisma, actor, jobId);
  const allowed = ["ADDITIONAL_EQUIPMENT", "AFTER_HOURS", "DISPOSAL_FEE", "OTHER"];
  if (!allowed.includes(input.kind)) throw badRequest("This charge type cannot be added from the field.");
  const unit = parseDollarRateToCentsString(input.unitPrice);
  if (!unit) throw badRequest("Enter a valid price.");
  if (!/^\d+(\.\d{1,3})?$/.test(input.quantity) || Number(input.quantity) <= 0) throw badRequest("Enter a valid quantity.");
  return prisma.$transaction(async (tx) => {
    const charge = await tx.jobCharge.create({
      data: { jobId, kind: input.kind as never, description: input.description.slice(0, 300), quantity: new Prisma.Decimal(input.quantity), unitPriceCents: new Prisma.Decimal(unit), addedById: actor.userId, status: "PENDING_APPROVAL" },
    });
    await audit(tx, { actorId: actor.userId, action: "job.charge_add", entityType: "Job", entityId: jobId, organizationId: job.organizationId, after: input });
    return charge;
  });
}

export async function reviewJobCharge(actor: Actor, chargeId: string, approve: boolean) {
  assertStaffActor(actor, ["jobs.approve", "invoices.write"]);
  const c = await prisma.jobCharge.findUnique({ where: { id: chargeId }, include: { job: true } });
  if (!c) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.jobCharge.update({ where: { id: chargeId }, data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: approve ? "job.charge_approve" : "job.charge_reject", entityType: "JobCharge", entityId: chargeId, organizationId: c.job.organizationId });
  });
}

// ── Office review ────────────────────────────────────────────────────────────

export async function approveJob(actor: Actor, jobId: string, note?: string) {
  assertStaffActor(actor, "jobs.approve");
  const billing = await getSetting("billing");
  const result = await prisma.$transaction(
    async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobId }, include: { manifest: true, charges: true } });
      if (!job) throw notFound();
      assertTransition(job.status as JobStatus, "COMPLETED", "reviewer");
      if (job.charges.some((c) => c.status === "PENDING_APPROVAL")) throw badRequest("Approve or reject the driver's additional charges first.");
      if (!job.manifest) throw badRequest("This job has no manifest.");
      // Finalization enforces required template fields and throws when incomplete.
      await finalizeManifest(actor, job.manifest.id, { db: tx, note });
      await tx.job.update({ where: { id: jobId }, data: { status: "COMPLETED", approvedAt: new Date(), approvedById: actor.userId } });
      await tx.jobStatusEvent.create({ data: { jobId, fromStatus: job.status, toStatus: "COMPLETED", actorId: actor.userId, note: note ?? "Documentation approved" } });
      await tx.serviceRecord.update({ where: { jobId }, data: { reviewStatus: "APPROVED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNotes: note ?? null } });
      // Approved service photos become visible to the customer.
      await tx.document.updateMany({ where: { jobId, type: "SERVICE_PHOTO", photoPhase: { in: ["BEFORE", "AFTER"] }, deletedAt: null }, data: { visibility: "CUSTOMER" } });
      await syncEmergencyForJob(tx, jobId, "COMPLETED", actor.userId);
      await audit(tx, { actorId: actor.userId, action: "job.approve", entityType: "Job", entityId: jobId, organizationId: job.organizationId, reason: note ?? null });
      let invoiceId: string | null = null;
      if (billing.autoInvoiceOnApproval) {
        const { generateInvoiceForJob } = await import("./invoices");
        invoiceId = (await generateInvoiceForJob(actor, jobId, { db: tx, send: billing.autoSendInvoices }))?.id ?? null;
      }
      return { invoiceId };
    },
    { timeout: 60_000 },
  );
  return result;
}

export async function rejectJob(actor: Actor, jobId: string, reason: string) {
  assertStaffActor(actor, "jobs.approve");
  if (reason.trim().length < 5) throw badRequest("Explain what needs to be corrected.");
  return prisma.$transaction(async (tx) => {
    const job = await tx.job.findUnique({ where: { id: jobId }, include: { manifest: true, driver: true } });
    if (!job) throw notFound();
    assertTransition(job.status as JobStatus, "PENDING_DOCUMENTATION", "reviewer");
    await tx.job.update({ where: { id: jobId }, data: { status: "PENDING_DOCUMENTATION" } });
    await tx.jobStatusEvent.create({ data: { jobId, fromStatus: job.status, toStatus: "PENDING_DOCUMENTATION", actorId: actor.userId, note: `Correction requested: ${reason}` } });
    await tx.serviceRecord.update({ where: { jobId }, data: { reviewStatus: "REJECTED", reviewNotes: reason, reviewedById: actor.userId, reviewedAt: new Date() } });
    if (job.manifest) await rejectManifest(tx, actor, job.manifest.id, reason);
    await audit(tx, { actorId: actor.userId, action: "job.reject", entityType: "Job", entityId: jobId, organizationId: job.organizationId, reason });
    if (job.driver) {
      await notify(tx, {
        userIds: [job.driver.userId],
        type: "manifest.correction",
        title: `Correction requested: ${job.jobNumber}`,
        body: reason,
        link: `/driver/jobs/${jobId}/complete`,
        entityType: "Job",
        entityId: jobId,
        dedupeKey: `job:${jobId}:rejected:${Date.now()}`,
      });
    }
  });
}

/** Driver issue reports (service, vehicle, equipment, safety). */
export const issueSchema = z.object({
  jobId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  vehicleId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  category: z.enum(["SERVICE", "ACCESS", "EQUIPMENT", "VEHICLE", "SAFETY", "CUSTOMER", "OTHER"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  description: z.string().trim().min(5, "Describe the issue.").max(4000),
});

export async function reportIssue(actor: Actor, input: z.infer<typeof issueSchema>) {
  const driver = assertDriverActor(actor);
  return prisma.$transaction(async (tx) => {
    if (input.jobId && !(await tx.job.count({ where: { id: input.jobId, driverId: driver.driverId } }))) throw notFound();
    const report = await tx.issueReport.create({ data: { reportNumber: await numbers.issue(tx), reportedById: actor.userId, jobId: input.jobId ?? null, vehicleId: input.vehicleId ?? null, category: input.category, severity: input.severity, description: input.description } });
    if (input.vehicleId && input.category === "VEHICLE" && (input.severity === "CRITICAL" || input.severity === "HIGH")) {
      // Flag the truck so dispatch sees it; does not automatically take it out of service.
      await tx.vehicle.update({ where: { id: input.vehicleId }, data: { notes: `Driver-reported ${input.severity.toLowerCase()} issue ${report.reportNumber}: ${input.description.slice(0, 200)}` } });
    }
    await notify(tx, {
      userIds: await staffWithPermission(tx, input.category === "VEHICLE" ? "fleet.write" : "jobs.dispatch"),
      type: "admin.issue",
      title: `${input.severity === "CRITICAL" ? "CRITICAL: " : ""}Driver reported ${input.category.toLowerCase()} issue`,
      body: `${actor.name}: ${input.description.slice(0, 240)}`,
      link: `/admin/drivers?tab=issues`,
      entityType: "IssueReport",
      entityId: report.id,
      dedupeKey: `issue:${report.id}`,
    });
    return report;
  });
}

export function serviceDateKey(job: { scheduledDate: Date }) {
  return keyFromDate(job.scheduledDate);
}
