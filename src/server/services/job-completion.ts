import "server-only";
import { z } from "zod";
import type { JobStatus } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, conflict, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { sendEmail, renderEmailHtml } from "../integrations/email";
import { storage } from "../storage";
import { jobShareUrl } from "../share";
import { instantToDateKey, formatDateKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { storeDocument } from "./documents";
import { ensureManifest, writeSubmittedVersion } from "./manifests";
import { advancePlan } from "./plans";
import { approveJob, signManifest, submitSchema } from "./field";
import { syncEmergencyForJob } from "./jobs";
import { customerRecipientsForLocation, queueContactTexts } from "./notifications";
import { companyTimeZone, getSetting } from "./settings";

/**
 * One-tap completion from the dispatch board, for owner-operators who drive the truck
 * themselves: record gallons, photos and signatures, finalize the manifest, issue the invoice,
 * then email and text the customer their paperwork.
 */
export const completeJobSchema = submitSchema.and(
  z.object({
    jobId: z.string().uuid(),
    assetIds: z.array(z.string().uuid()).max(20).default([]),
    assetGallons: z.array(z.coerce.number().int("Whole gallons only.").min(0).max(100_000)).max(20).default([]),
    gallons: z.coerce.number().int("Whole gallons only.").min(0).max(100_000).optional(),
    wasteType: z.string().trim().min(2).max(120).optional(),
    notes: z.string().trim().max(2000).optional(),
  }),
);
export type CompleteJobInput = z.infer<typeof completeJobSchema>;

const COMPLETABLE: JobStatus[] = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "MISSED", "UNABLE_TO_SERVICE"];
export const TRUCK_CAPACITY_DEFAULT = 2500;

function wasteFor(serviceType: string) {
  if (/GRIT/.test(serviceType)) return "Grit trap waste";
  if (/SEPTIC/.test(serviceType)) return "Septic waste";
  if (/LINT/.test(serviceType)) return "Lint trap waste";
  if (/LIFT/.test(serviceType)) return "Lift station waste";
  return "Grease trap waste";
}

/** The owner's field profile (created on first use) and the company truck. */
async function fieldCrew(tx: Db, actor: Actor) {
  let driver = await tx.driver.findUnique({ where: { userId: actor.userId } });
  if (!driver) driver = await tx.driver.create({ data: { userId: actor.userId, employeeNumber: await numbers.employee(tx) } });
  else if (driver.status !== "ACTIVE") driver = await tx.driver.update({ where: { id: driver.id }, data: { status: "ACTIVE" } });
  let truck = await tx.vehicle.findFirst({ where: { status: { notIn: ["OUT_OF_SERVICE"] } }, orderBy: { unitNumber: "asc" } });
  if (!truck) truck = await tx.vehicle.create({ data: { unitNumber: "Truck 1", tankCapacityGallons: TRUCK_CAPACITY_DEFAULT } });
  return { driver, truck };
}

export type CompletionResult = { invoiceNumber: string | null; invoiceSent: boolean; emailedTo: string[]; texted: number; problems: string[] };

export async function completeJobFromBoard(actor: Actor, input: CompleteJobInput, photos: { bytes: Uint8Array; name: string; phase: "BEFORE" | "AFTER" | "CITY_MANIFEST" }[], meta: { ip: string | null }): Promise<CompletionResult> {
  assertStaffActor(actor, "jobs.approve");
  const tz = await companyTimeZone();
  await prisma.$transaction(
    async (tx) => {
      const job = await tx.job.findUnique({ where: { id: input.jobId }, include: { location: true, assets: true } });
      if (!job) throw notFound();
      if (job.status === "COMPLETED") throw badRequest("This job is already completed.");
      if (job.status === "CANCELLED") throw badRequest("This job was cancelled.");
      if (job.status === "SUBMITTED") return; // documented in the driver app already; just approve below
      if (!COMPLETABLE.includes(job.status)) throw badRequest("This job can't be completed from here.");

      const { driver, truck } = await fieldCrew(tx, actor);
      const vehicleId = job.vehicleId ?? truck.id;
      if (job.driverId !== driver.id || job.vehicleId !== vehicleId) {
        await tx.job.update({ where: { id: job.id }, data: { driverId: driver.id, vehicleId } });
      }

      // Gallons per piece of equipment. A location without equipment on file gets one added.
      let rows = input.assetIds.map((assetId, i) => ({ assetId, gallons: input.assetGallons[i] ?? 0 }));
      if (rows.length) {
        const ok = await tx.serviceAsset.count({ where: { id: { in: rows.map((r) => r.assetId) }, locationId: job.locationId, deletedAt: null } });
        if (ok !== rows.length) throw badRequest("Equipment must belong to this location.");
      } else {
        if (input.gallons === undefined) throw badRequest("Enter the gallons pumped.");
        let asset = await tx.serviceAsset.findFirst({ where: { locationId: job.locationId, deletedAt: null, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
        if (!asset) {
          const grit = /GRIT/.test(job.serviceType);
          asset = await tx.serviceAsset.create({
            data: { assetTag: await numbers.asset(tx), organizationId: job.organizationId, locationId: job.locationId, type: grit ? "GRIT_TRAP" : "GREASE_TRAP", name: grit ? "Grit trap" : "Grease trap", capacityGallons: Math.max(input.gallons, 1), placement: "OUTDOOR", createdById: actor.userId },
          });
        }
        rows = [{ assetId: asset.id, gallons: input.gallons }];
      }
      if (rows.every((r) => r.gallons === 0) && /PUMPING|TRAP|SEPTIC|LIFT/.test(job.serviceType)) throw badRequest("Enter the gallons pumped.");

      const now = new Date();
      const wasteType = input.wasteType || wasteFor(job.serviceType);
      const record = await tx.serviceRecord.upsert({
        where: { jobId: job.id },
        create: { jobId: job.id, driverId: driver.id, vehicleId, arrivedAt: now, startedAt: now, finishedAt: now, submittedAt: now, wasteType, notes: input.notes || null, reviewStatus: "SUBMITTED" },
        update: { driverId: driver.id, vehicleId, finishedAt: now, submittedAt: now, wasteType, ...(input.notes ? { notes: input.notes } : {}), reviewStatus: "SUBMITTED" },
      });
      const assets = await tx.serviceAsset.findMany({ where: { id: { in: rows.map((r) => r.assetId) } } });
      await tx.serviceAssetRecord.deleteMany({ where: { serviceRecordId: record.id, assetId: { notIn: rows.map((r) => r.assetId) } } });
      for (const r of rows) {
        const a = assets.find((x) => x.id === r.assetId)!;
        const data = { capacityGallons: a.capacityGallons, gallonsPumped: r.gallons, wasteType, servicePerformed: SERVICE_TYPE_LABEL[job.serviceType] ?? null };
        await tx.serviceAssetRecord.upsert({ where: { serviceRecordId_assetId: { serviceRecordId: record.id, assetId: r.assetId } }, create: { serviceRecordId: record.id, assetId: r.assetId, ...data }, update: data });
      }
      await tx.job.update({ where: { id: job.id }, data: { assets: { connectOrCreate: rows.map((r) => ({ where: { jobId_assetId: { jobId: job.id, assetId: r.assetId } }, create: { assetId: r.assetId } })) } } });

      for (const p of photos) {
        if (p.phase === "CITY_MANIFEST") {
          await storeDocument(tx, { bytes: p.bytes, fileName: p.name, title: `City of Houston manifest — ${job.jobNumber}`, type: "MANIFEST_OFFICIAL", visibility: "CUSTOMER", organizationId: job.organizationId, locationId: job.locationId, jobId: job.id, uploadedById: actor.userId });
        } else {
          await storeDocument(tx, { bytes: p.bytes, fileName: p.name, title: `${p.phase === "BEFORE" ? "Before" : "After"} photo — ${job.jobNumber}`, type: "SERVICE_PHOTO", photoPhase: p.phase, organizationId: job.organizationId, locationId: job.locationId, jobId: job.id, uploadedById: actor.userId, imagesOnly: true });
        }
      }

      const manifest = await ensureManifest(tx, job.id);
      await signManifest(tx, { job, manifestId: manifest.id, manifestNumber: manifest.manifestNumber, actor, input, ip: meta.ip });

      const moved = await tx.job.updateMany({ where: { id: job.id, status: job.status }, data: { status: "SUBMITTED", completedAt: now } });
      if (moved.count !== 1) throw conflict("This job was updated elsewhere. Refresh and try again.");
      await tx.jobStatusEvent.create({ data: { jobId: job.id, fromStatus: job.status, toStatus: "SUBMITTED", actorId: actor.userId, note: input.customerUnavailable ? `Completed from dispatch board. Customer representative unavailable: ${input.customerUnavailableReason}` : "Completed from dispatch board" } });
      await tx.serviceAsset.updateMany({ where: { id: { in: rows.map((r) => r.assetId) } }, data: { lastServicedAt: now } });
      await writeSubmittedVersion(tx, manifest.id, actor.userId);
      await syncEmergencyForJob(tx, job.id, "SUBMITTED", actor.userId);
      await advancePlan(tx, job, instantToDateKey(now, tz), actor.userId);
      await audit(tx, { actorId: actor.userId, action: "job.complete_from_board", entityType: "Job", entityId: job.id, organizationId: job.organizationId, after: { gallons: rows, photos: photos.length, customerUnavailable: input.customerUnavailable } });
    },
    { timeout: 60_000 },
  );

  // Office approval: finalizes the manifest PDF and issues the invoice (sent quietly — the
  // completion email below carries it).
  await approveJob(actor, input.jobId, "Completed from dispatch board", { invoice: { send: true, quiet: true } });
  return sendCompletionPackage(actor, input.jobId);
}

/** Who gets the paperwork by email: billing and primary contacts, the account email, the site contact. */
async function completionEmails(db: Db, job: { organizationId: string; locationId: string; organization: { primaryEmail: string | null }; location: { siteContactEmail: string | null } }, billingEmail: string | null) {
  const contacts = await db.customerContact.findMany({
    where: { organizationId: job.organizationId, email: { not: null }, OR: [{ locationId: null }, { locationId: job.locationId }], AND: [{ OR: [{ isPrimary: true }, { receivesInvoices: true }, { receivesReminders: true }] }] },
    select: { email: true },
  });
  const portalUsers = await db.user.findMany({ where: { id: { in: await customerRecipientsForLocation(db, job.organizationId, job.locationId) } }, select: { email: true } });
  const all = [billingEmail, job.organization.primaryEmail, job.location.siteContactEmail, ...contacts.map((c) => c.email), ...portalUsers.map((u) => u.email)];
  return [...new Set(all.filter((e): e is string => !!e && /.+@.+\..+/.test(e)).map((e) => e.trim().toLowerCase()))];
}

const MAX_ATTACH_BYTES = 18 * 1024 * 1024;

/**
 * Email the customer the manifest, invoice and service photos (as attachments, with a link to
 * view them online) and text opted-in contacts the link. Safe to call again to resend.
 */
export async function sendCompletionPackage(actor: Actor, jobId: string, opts: { resend?: boolean } = {}): Promise<CompletionResult> {
  assertStaffActor(actor, ["jobs.approve", "invoices.write"]);
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      location: true,
      organization: true,
      serviceRecord: { include: { assetRecords: true } },
      manifest: true,
      invoices: { where: { status: { not: "VOID" } }, include: { billingProfile: true }, orderBy: { createdAt: "desc" }, take: 1 },
      documents: { where: { deletedAt: null, OR: [{ type: "SERVICE_PHOTO", photoPhase: { in: ["BEFORE", "AFTER"] } }, { type: { in: ["MANIFEST", "MANIFEST_OFFICIAL"] }, visibility: "CUSTOMER" }] }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!job) throw notFound();
  if (job.status !== "COMPLETED") throw badRequest("Complete the job first.");
  const problems: string[] = [];
  const invoice = job.invoices[0] ?? null;
  const invoiceSent = !!invoice && invoice.status !== "DRAFT";
  if (!invoice) problems.push("No invoice was created — add a price for this customer, then create the invoice from the job page.");
  else if (!invoiceSent) problems.push(`Invoice ${invoice.invoiceNumber} is a draft (no price on file). Add the price on the invoice and send it.`);

  const invoiceDocs = invoiceSent ? await prisma.document.findMany({ where: { invoiceId: invoice!.id, type: "INVOICE", deletedAt: null }, include: { versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, take: 1 }) : [];
  const files = [...job.documents.filter((d) => d.type !== "SERVICE_PHOTO"), ...invoiceDocs, ...job.documents.filter((d) => d.type === "SERVICE_PHOTO")];
  const attachments: { filename: string; content: Uint8Array }[] = [];
  let size = 0;
  let photoNo = 0;
  for (const d of files) {
    const v = d.versions[0];
    if (!v || size + v.sizeBytes > MAX_ATTACH_BYTES) continue;
    try {
      const bytes = await storage().get(v.storageKey);
      size += bytes.byteLength;
      const ext = v.fileName.split(".").pop() ?? "bin";
      const name = d.type === "SERVICE_PHOTO" ? `${d.photoPhase === "BEFORE" ? "Before" : "After"} photo ${++photoNo}.${ext}` : d.type === "INVOICE" ? `Invoice ${invoice!.invoiceNumber}.pdf` : d.type === "MANIFEST" ? `Manifest ${job.manifest?.manifestNumber ?? ""}.pdf` : v.fileName;
      attachments.push({ filename: name, content: bytes });
    } catch {
      // A missing file is skipped; the online link still lists everything that exists.
    }
  }

  const [company] = await Promise.all([getSetting("company")]);
  const link = jobShareUrl(job.id);
  const gallons = job.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0;
  const service = SERVICE_TYPE_LABEL[job.serviceType] ?? "Service";
  const day = formatDateKey(instantToDateKey(job.completedAt ?? new Date(), await companyTimeZone()), "long");
  const subject = `${service} completed — ${job.location.name}`;
  const lines = [
    `Hi ${job.organization.name},`,
    `Your ${service.toLowerCase()} at ${job.location.name} (${job.location.addressLine1}) was completed on ${day}${gallons ? ` — ${gallons.toLocaleString()} gallons removed` : ""}.`,
    `Attached: ${["your waste manifest", invoiceSent ? `invoice ${invoice!.invoiceNumber} (${formatCents(invoice!.balanceCents)} due)` : null, photoNo ? `${photoNo} service photo${photoNo > 1 ? "s" : ""}` : null].filter(Boolean).join(", ")}.`,
    `You can also view and download everything here: ${link}`,
    company.phone ? `Questions? Call or text us at ${company.phone}.` : "Questions? Just reply to this email.",
    `Thank you,\n${company.name}`,
  ];
  const text = lines.join("\n\n");
  const recipients = await completionEmails(prisma, job, invoice?.billingProfile?.billingEmail ?? null);
  const emailedTo: string[] = [];
  for (const to of recipients) {
    const res = await sendEmail({ to, subject, text, html: renderEmailHtml(subject, lines.filter((l) => !l.startsWith("You can also")).join("\n\n"), { label: "View photos, manifest & invoice", url: link }, `${company.name}${company.phone ? ` · ${company.phone}` : ""}${company.email ? ` · ${company.email}` : ""}`), replyTo: company.email || undefined, attachments });
    if (res.status === "sent") emailedTo.push(to);
    else if (res.status === "skipped") problems.push(`Email isn't set up yet (${res.reason})`);
    else problems.push(`Email to ${to} failed: ${res.error}`);
  }
  if (recipients.length === 0) problems.push("No email address on file for this customer — add one to the customer's contacts.");

  const stamp = opts.resend ? `:${Date.now()}` : "";
  const texted = await queueContactTexts(prisma, {
    type: "service.completed",
    title: `Service complete at ${job.location.name}`,
    body: `${gallons ? `${gallons.toLocaleString()} gal pumped. ` : ""}Photos, manifest${invoiceSent ? " & invoice" : ""}: ${link}`,
    dedupeKey: `job:${job.id}:package${stamp}`,
    organizationId: job.organizationId,
    locationId: job.locationId,
  });

  const userIds = await customerRecipientsForLocation(prisma, job.organizationId, job.locationId);
  if (userIds.length) {
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({ userId, type: "service.completed", title: subject, body: `Your manifest${invoiceSent ? ", invoice" : ""} and photos are ready.`, link: `/customer/services/${job.id}`, entityType: "Job", entityId: job.id, dedupeKey: `job:${job.id}:package${stamp}` })),
      skipDuplicates: true,
    });
  }
  await audit(prisma, { actorId: actor.userId, action: opts.resend ? "job.completion_resent" : "job.completion_sent", entityType: "Job", entityId: job.id, organizationId: job.organizationId, after: { emailedTo, texted, attachments: attachments.length, problems } });
  return { invoiceNumber: invoice?.invoiceNumber ?? null, invoiceSent, emailedTo, texted, problems: [...new Set(problems)] };
}
