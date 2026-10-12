import "server-only";
import type { ManifestStatus, Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { sha256Hex } from "../crypto";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { formatAddress } from "@/lib/utils";
import { dateFromKey, isDateKey, keyFromDate } from "@/lib/dates";
import { numbers } from "../numbering";
import { ASSET_TYPE_LABEL } from "@/lib/status";
import { getSetting } from "./settings";
import { DEFAULT_TEMPLATE_FIELDS, missingRequiredFields, type ManifestData, type TemplateField } from "@/domain/manifest";
export { DEFAULT_TEMPLATE_FIELDS, missingRequiredFields, type ManifestData, type TemplateField };
import { customerRecipientsForLocation, notify } from "./notifications";
import { storeDocument } from "./documents";

export async function resolveTemplate(db: Db, serviceType: string, wasteType: string | null) {
  const templates = await db.manifestTemplate.findMany({ where: { active: true }, orderBy: [{ isDefault: "asc" }] });
  const specific = templates.find((t) => t.serviceTypes.includes(serviceType as never) && (!wasteType || t.wasteTypes.length === 0 || t.wasteTypes.includes(wasteType)));
  return specific ?? templates.find((t) => t.isDefault) ?? null;
}

export function templateFields(template: { fields: Prisma.JsonValue } | null): TemplateField[] {
  if (!template || !Array.isArray(template.fields)) return DEFAULT_TEMPLATE_FIELDS;
  return template.fields as unknown as TemplateField[];
}

/** Build the manifest snapshot from current system records. */
export async function buildManifestData(db: Db, jobId: string, overrides?: { extra?: Record<string, string>; verification?: ManifestData["verification"] }): Promise<ManifestData> {
  const job = await db.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      location: true,
      organization: true,
      vehicle: true,
      driver: { include: { user: true } },
      serviceRecord: { include: { assetRecords: { include: { asset: true } } } },
      manifest: { include: { signatures: true, template: true } },
      loadAllocations: { include: { disposalEvent: { include: { facility: true } } }, orderBy: { disposalEvent: { disposedAt: "desc" } } },
    },
  });
  const hauler = await getSetting("hauler", db);
  const company = await getSetting("company", db);
  const rec = job.serviceRecord;
  const assets = rec?.assetRecords ?? [];
  const sigs = job.manifest?.signatures ?? [];
  const latest = (role: string) => sigs.filter((s) => s.role === role).sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())[0];
  const cust = latest("CUSTOMER");
  const drv = latest("DRIVER");
  const disposal = job.loadAllocations[0]?.disposalEvent ?? null;
  const prevData = (job.manifest && job.manifest.currentVersion > 0
    ? (await db.manifestVersion.findUnique({ where: { manifestId_version: { manifestId: job.manifest.id, version: job.manifest.currentVersion } } }))?.data
    : null) as ManifestData | null;
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

  return {
    template: job.manifest?.template ? { key: job.manifest.template.key, name: job.manifest.template.name, jurisdiction: job.manifest.template.jurisdiction } : null,
    reference: { manifestNumber: job.manifest?.manifestNumber ?? "", jobNumber: job.jobNumber, serviceDate: keyFromDate(job.manifest?.serviceDate ?? job.scheduledDate) },
    generator: {
      businessName: job.location.name,
      organizationName: job.organization.name,
      accountNumber: job.organization.accountNumber,
      address: formatAddress(job.location),
      locationName: job.location.name,
      county: job.location.county,
      contactName: job.location.siteContactName,
      contactPhone: job.location.siteContactPhone,
      postalCode: job.location.postalCode || null,
      cityCounty: [job.location.city, job.location.county].filter(Boolean).join(" / ") || null,
    },
    collection: {
      wasteType: rec?.wasteType ?? assets[0]?.wasteType ?? null,
      equipment: assets.map((a) => ({ assetTag: a.asset.assetTag, type: a.asset.type === "OTHER" && a.asset.customTypeLabel ? a.asset.customTypeLabel : ASSET_TYPE_LABEL[a.asset.type] ?? a.asset.type, capacityGallons: a.capacityGallons, gallonsPumped: a.gallonsPumped, servicePerformed: a.servicePerformed })),
      totalGallons: assets.reduce((s, a) => s + a.gallonsPumped, 0),
      startedAt: iso(rec?.startedAt ?? rec?.arrivedAt),
      finishedAt: iso(rec?.finishedAt),
      notes: rec?.notes ?? null,
    },
    hauler: {
      name: hauler.legalName || company.name || null,
      transporterPermitNumber: hauler.transporterPermitNumber || null,
      registrationNumber: hauler.registrationNumber || null,
      driverName: job.driver?.user.name ?? null,
      truckUnit: job.vehicle?.unitNumber ?? null,
      vin: job.vehicle?.vin ?? null,
      licensePlate: job.vehicle?.licensePlate ?? null,
      vehiclePermit: job.vehicle?.permitNumber ?? null,
      certificationStatement: hauler.certificationStatement || null,
      tceqNumber: hauler.tceqNumber || null,
      address: [company.addressLine1, [company.city, company.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null,
      phone: company.phone || null,
    },
    disposal: disposal
      ? {
          facilityName: disposal.facility.name,
          facilityAddress: `${disposal.facility.addressLine1}, ${disposal.facility.city}, ${disposal.facility.state} ${disposal.facility.postalCode}`,
          facilityPermit: disposal.facility.permitNumber,
          disposedAt: disposal.disposedAt.toISOString(),
          ticketNumber: disposal.ticketNumber,
          facilityAcknowledged: disposal.facilityAcknowledged,
          gallonsReceived: disposal.gallons,
        }
      : { facilityName: null, facilityAddress: null, facilityPermit: null, disposedAt: null, ticketNumber: null, facilityAcknowledged: false, gallonsReceived: null },
    signatures: {
      customer: cust ? { name: cust.signerName || null, title: cust.signerTitle, signedAt: cust.signedAt.toISOString(), unavailable: cust.unavailable, unavailableReason: cust.unavailableReason, hasImage: Boolean(cust.signatureDocumentId) } : null,
      driver: drv ? { name: drv.signerName, signedAt: drv.signedAt.toISOString(), hasImage: Boolean(drv.signatureDocumentId) } : null,
    },
    verification: overrides?.verification ?? prevData?.verification ?? { verifiedBy: null, verifiedAt: null },
    extra: { ...(prevData?.extra ?? {}), ...(overrides?.extra ?? {}) },
  };
}

async function writeVersion(db: Db, manifestId: string, data: ManifestData, opts: { actorId: string | null; reason: string | null; isFinal: boolean }) {
  const m = await db.manifest.findUniqueOrThrow({ where: { id: manifestId } });
  const version = m.currentVersion + 1;
  const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
  const row = await db.manifestVersion.create({
    data: { manifestId, version, data: json, contentHash: sha256Hex(JSON.stringify(json)), reason: opts.reason, isFinal: opts.isFinal, createdById: opts.actorId },
  });
  await db.manifest.update({ where: { id: manifestId }, data: { currentVersion: version, totalGallons: data.collection.totalGallons, wasteType: data.collection.wasteType, driverName: data.hauler.driverName } });
  return row;
}

/** Driver submission: create (or reopen) the manifest and snapshot version N as submitted data. */
export async function ensureManifest(db: Db, jobId: string) {
  const job = await db.job.findUniqueOrThrow({ where: { id: jobId }, include: { manifest: true, serviceRecord: true } });
  let manifest = job.manifest;
  if (!manifest) {
    const template = await resolveTemplate(db, job.serviceType, job.serviceRecord?.wasteType ?? null);
    manifest = await db.manifest.create({
      data: { manifestNumber: await numbers.manifest(db), jobId, organizationId: job.organizationId, locationId: job.locationId, templateId: template?.id ?? null, serviceDate: job.scheduledDate, status: "SUBMITTED", isDemo: job.isDemo },
    });
  }
  return manifest;
}

export async function writeSubmittedVersion(db: Db, manifestId: string, actorId: string) {
  const m = await db.manifest.findUniqueOrThrow({ where: { id: manifestId } });
  const data = await buildManifestData(db, m.jobId);
  await writeVersion(db, manifestId, data, { actorId, reason: m.currentVersion === 0 ? "Driver submission" : "Driver resubmission", isFinal: false });
  await db.manifest.update({ where: { id: manifestId }, data: { status: "PENDING_REVIEW", rejectionReason: null } });
}

/**
 * Approve and finalize. Refuses when required template fields are missing — incomplete
 * documentation is never approved automatically.
 */
export async function finalizeManifest(actor: Actor, manifestId: string, opts: { db?: Db; note?: string } = {}) {
  assertStaffActor(actor, "manifests.review");
  const run = async (tx: Db) => {
    const m = await tx.manifest.findUnique({ where: { id: manifestId }, include: { template: true, location: true, job: true } });
    if (!m) throw notFound();
    if (!["SUBMITTED", "PENDING_REVIEW", "APPROVED"].includes(m.status)) throw badRequest(`A ${m.status.toLowerCase().replace(/_/g, " ")} manifest cannot be finalized.`);
    const data = await buildManifestData(tx, m.jobId, { verification: { verifiedBy: actor.name, verifiedAt: new Date().toISOString() } });
    const missing = missingRequiredFields(templateFields(m.template), data);
    if (missing.length) throw badRequest(`Cannot finalize — missing required fields: ${missing.map((f) => f.label).join(", ")}.`);
    const version = await writeVersion(tx, manifestId, data, { actorId: actor.userId, reason: opts.note ?? "Approved and finalized", isFinal: true });
    await tx.manifest.update({ where: { id: manifestId }, data: { status: "FINALIZED", approvedAt: new Date(), approvedById: actor.userId, finalizedAt: new Date(), finalizedById: actor.userId, rejectionReason: null } });
    const pdfBytes = await (await import("../pdf/manifest-pdf")).renderManifestPdf(tx, manifestId, version.version);
    const doc = await storeDocument(tx, {
      bytes: pdfBytes,
      fileName: `${m.manifestNumber}-v${version.version}.pdf`,
      title: `Manifest ${m.manifestNumber}${version.version > 1 ? ` (v${version.version})` : ""}`,
      type: "MANIFEST",
      visibility: "CUSTOMER",
      organizationId: m.organizationId,
      locationId: m.locationId,
      jobId: m.jobId,
      manifestId,
      uploadedById: actor.userId,
      trusted: { mime: "application/pdf", ext: "pdf" },
    });
    // Older generated PDFs stay in history but are hidden from customers once superseded.
    await tx.document.updateMany({ where: { manifestId, type: "MANIFEST", id: { not: doc.id } }, data: { visibility: "INTERNAL" } });
    await tx.manifestVersion.update({ where: { id: version.id }, data: { pdfDocumentId: doc.id } });
    await audit(tx, { actorId: actor.userId, action: "manifest.finalize", entityType: "Manifest", entityId: manifestId, organizationId: m.organizationId, after: { version: version.version, contentHash: version.contentHash } });
    await notify(tx, {
      userIds: await customerRecipientsForLocation(tx, m.organizationId, m.locationId),
      type: "manifest.available",
      title: `Manifest ${m.manifestNumber} is available`,
      body: `The waste manifest for your service at ${m.location.name} has been finalized and is ready to download.`,
      link: `/customer/manifests`,
      entityType: "Manifest",
      entityId: manifestId,
      dedupeKey: `manifest:${manifestId}:final:v${version.version}`,
    });
    return version;
  };
  return opts.db ? run(opts.db) : prisma.$transaction(run, { timeout: 30_000 });
}

export async function rejectManifest(db: Db, actor: Actor, manifestId: string, reason: string) {
  assertStaffActor(actor, "manifests.review");
  const m = await db.manifest.findUnique({ where: { id: manifestId } });
  if (!m) throw notFound();
  if (m.status === "FINALIZED") throw badRequest("Finalized manifests are corrected through a revision, not rejected.");
  await db.manifest.update({ where: { id: manifestId }, data: { status: "REJECTED", rejectionReason: reason } });
  await audit(db, { actorId: actor.userId, action: "manifest.reject", entityType: "Manifest", entityId: manifestId, organizationId: m.organizationId, reason });
}

/**
 * Administrative correction. Creates a new auditable version; a finalized manifest becomes
 * PENDING_REVIEW for the revision while the previously finalized version remains the
 * customer-facing record until the revision is finalized.
 */
export async function correctManifest(actor: Actor, manifestId: string, input: { extra?: Record<string, string>; reason: string }) {
  assertStaffActor(actor, "manifests.review");
  if (input.reason.trim().length < 5) throw badRequest("Describe the reason for the correction.");
  return prisma.$transaction(async (tx) => {
    const m = await tx.manifest.findUnique({ where: { id: manifestId } });
    if (!m) throw notFound();
    const previous = m.currentVersion ? await tx.manifestVersion.findUnique({ where: { manifestId_version: { manifestId, version: m.currentVersion } } }) : null;
    const data = await buildManifestData(tx, m.jobId, { extra: input.extra, verification: { verifiedBy: null, verifiedAt: null } });
    const v = await writeVersion(tx, manifestId, data, { actorId: actor.userId, reason: `Correction: ${input.reason}`, isFinal: false });
    await tx.manifest.update({ where: { id: manifestId }, data: { status: "PENDING_REVIEW" } });
    await audit(tx, { actorId: actor.userId, action: "manifest.correct", entityType: "Manifest", entityId: manifestId, organizationId: m.organizationId, before: { version: previous?.version, data: previous?.data }, after: { version: v.version, data }, reason: input.reason });
    return v;
  });
}

export async function uploadOfficialManifest(actor: Actor, manifestId: string, file: { bytes: Uint8Array; name: string }, visibleToCustomer: boolean) {
  assertStaffActor(actor, "manifests.review");
  const m = await prisma.manifest.findUnique({ where: { id: manifestId } });
  if (!m) throw notFound();
  return prisma.$transaction(async (tx) => {
    const doc = await storeDocument(tx, {
      bytes: file.bytes,
      fileName: file.name,
      title: `Official manifest — ${m.manifestNumber}`,
      type: "MANIFEST_OFFICIAL",
      visibility: visibleToCustomer ? "CUSTOMER" : "INTERNAL",
      organizationId: m.organizationId,
      locationId: m.locationId,
      jobId: m.jobId,
      manifestId,
      uploadedById: actor.userId,
    });
    await audit(tx, { actorId: actor.userId, action: "manifest.upload_official", entityType: "Manifest", entityId: manifestId, organizationId: m.organizationId, after: { documentId: doc.id } });
    return doc;
  });
}

export function manifestListWhere(params: { q?: string; status?: string; from?: string; to?: string; wasteType?: string; driver?: string; organizationId?: string; locationIds?: string[] }): Prisma.ManifestWhereInput {
  return {
    ...(params.locationIds ? { locationId: { in: params.locationIds } } : {}),
    ...(params.organizationId ? { organizationId: params.organizationId } : {}),
    ...(params.status ? { status: params.status as ManifestStatus } : {}),
    ...(params.wasteType ? { wasteType: params.wasteType } : {}),
    ...(params.driver ? { driverName: { contains: params.driver, mode: "insensitive" } } : {}),
    ...(params.from || params.to
      ? { serviceDate: { ...(params.from && isDateKey(params.from) ? { gte: dateFromKey(params.from) } : {}), ...(params.to && isDateKey(params.to) ? { lte: dateFromKey(params.to) } : {}) } }
      : {}),
    ...(params.q
      ? {
          OR: [
            { manifestNumber: { contains: params.q, mode: "insensitive" } },
            { organization: { name: { contains: params.q, mode: "insensitive" } } },
            { location: { name: { contains: params.q, mode: "insensitive" } } },
            { job: { jobNumber: { contains: params.q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
}

/** Latest finalized version for customer-facing display. */
export async function latestFinalVersion(manifestId: string) {
  return prisma.manifestVersion.findFirst({ where: { manifestId, isFinal: true }, orderBy: { version: "desc" } });
}

/**
 * Invoices entered without a job still get Sewer Squad's manifest, filled from the invoice and
 * the customer's records, filed for the office and in the customer's portal. Idempotent.
 */
export async function generateInvoiceManifest(db: Db, invoiceId: string, actorId: string | null) {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lineItems: true, organization: true, serviceLocation: { include: { assets: { where: { deletedAt: null, status: "ACTIVE" } } } } },
  });
  if (inv.jobId || inv.manifestRef || !inv.serviceLocation) return null;
  const loc = inv.serviceLocation;
  const title = inv.serviceTitle ?? inv.lineItems[0]?.description ?? "Service";
  const gallons = inv.lineItems.filter((l) => l.kind === "PER_GALLON").reduce((s, l) => s + Math.round(Number(l.quantity)), 0);
  const kindFromTitle = /grit/i.test(title) ? "Grit Trap" : /lift/i.test(title) ? "Lift Station" : /septic/i.test(title) ? "Septic Tank" : /line|jett|snak|drain/i.test(title) ? "Sewer / Drain Line" : "Grease Trap";
  const assets = loc.assets.filter((a) => (ASSET_TYPE_LABEL[a.type] ?? a.type).toLowerCase().includes(kindFromTitle.split(" ")[0]!.toLowerCase()));
  const equipment = (assets.length ? assets : [{ assetTag: "", type: "", capacityGallons: 0, customTypeLabel: null }]).map((a, i) => ({
    assetTag: a.assetTag,
    type: a.type ? (ASSET_TYPE_LABEL[a.type] ?? a.type) : kindFromTitle,
    capacityGallons: a.capacityGallons,
    gallonsPumped: i === 0 ? gallons : 0,
    servicePerformed: title,
  }));
  const [hauler, company] = await Promise.all([getSetting("hauler", db), getSetting("company", db)]);
  const number = await numbers.manifest(db);
  const data: ManifestData = {
    template: null,
    reference: { manifestNumber: number, jobNumber: `Invoice ${inv.invoiceNumber}`, serviceDate: keyFromDate(inv.serviceDate ?? inv.issueDate) },
    generator: { businessName: loc.name, organizationName: inv.organization.name, accountNumber: inv.organization.accountNumber, address: formatAddress(loc), locationName: loc.name, county: loc.county, contactName: loc.siteContactName, contactPhone: loc.siteContactPhone, postalCode: loc.postalCode || null, cityCounty: [loc.city, loc.county].filter(Boolean).join(" / ") || null },
    collection: { wasteType: /grit/i.test(title) ? "Grit trap waste" : "Grease trap waste", equipment, totalGallons: gallons, startedAt: null, finishedAt: null, notes: null },
    hauler: { name: hauler.legalName || company.name || null, transporterPermitNumber: hauler.transporterPermitNumber || null, registrationNumber: hauler.registrationNumber || null, driverName: null, truckUnit: null, vin: null, licensePlate: null, vehiclePermit: null, certificationStatement: hauler.certificationStatement || null, tceqNumber: hauler.tceqNumber || null, address: [company.addressLine1, [company.city, company.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null, phone: company.phone || null },
    disposal: { facilityName: null, facilityAddress: null, facilityPermit: null, disposedAt: null, ticketNumber: null, facilityAcknowledged: false, gallonsReceived: null },
    signatures: { customer: null, driver: null },
    verification: { verifiedBy: null, verifiedAt: null },
    extra: {},
  };
  const { drawManifest } = await import("../pdf/manifest-pdf");
  const bytes = await drawManifest(db, { data, customerSignature: null, driverSignature: null, draft: false, integrity: `Manifest ${number} · invoice ${inv.invoiceNumber}` });
  const doc = await storeDocument(db, {
    bytes,
    fileName: `Manifest ${number}.pdf`,
    title: `Manifest ${number} — invoice ${inv.invoiceNumber}`,
    type: "MANIFEST",
    visibility: "CUSTOMER",
    organizationId: inv.organizationId,
    locationId: loc.id,
    invoiceId: inv.id,
    uploadedById: actorId,
    trusted: { mime: "application/pdf", ext: "pdf" },
  });
  await db.invoice.update({ where: { id: inv.id }, data: { manifestRef: number } });
  await audit(db, { actorId, action: "manifest.generate_for_invoice", entityType: "Invoice", entityId: inv.id, organizationId: inv.organizationId, after: { manifestNumber: number, documentId: doc.id } });
  return doc;
}
