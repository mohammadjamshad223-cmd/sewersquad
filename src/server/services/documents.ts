import "server-only";
import type { DocumentType, DocumentVisibility, PhotoPhase, Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { audit } from "../audit";
import { badRequest, forbidden, notFound } from "../errors";
import { randomToken, sha256Hex } from "../crypto";
import { storage } from "../storage";
import { ALLOWED_DESCRIPTION, detectFileType, sanitizeFileName } from "../storage/file-validation";
import type { Actor } from "../auth/session";
import { hasPermission } from "../authz/check";
import { customerScopeFor, documentScopedWhere } from "../authz/scope";
import { getSetting } from "./settings";

export type DocumentLinks = {
  organizationId?: string | null;
  locationId?: string | null;
  jobId?: string | null;
  manifestId?: string | null;
  invoiceId?: string | null;
  paymentId?: string | null;
  assetId?: string | null;
  inspectionId?: string | null;
  disposalEventId?: string | null;
  disposalBillId?: string | null;
  expenseId?: string | null;
  proposalId?: string | null;
  serviceReportId?: string | null;
  emergencyRequestId?: string | null;
  supportTicketId?: string | null;
  vehicleId?: string | null;
};

export type StoreInput = DocumentLinks & {
  bytes: Uint8Array;
  fileName: string;
  type: DocumentType;
  title?: string;
  visibility?: DocumentVisibility;
  photoPhase?: PhotoPhase | null;
  uploadedById: string | null;
  /** Generated documents (PDFs we render) skip the upload size limit. */
  trusted?: { mime: string; ext: string };
  imagesOnly?: boolean;
};

async function validated(input: StoreInput) {
  if (input.trusted) return input.trusted;
  const limitMb = (await getSetting("documents")).maxUploadMb;
  if (input.bytes.byteLength === 0) throw badRequest("The file is empty.");
  if (input.bytes.byteLength > limitMb * 1024 * 1024) throw badRequest(`Files must be ${limitMb} MB or smaller.`);
  const detected = detectFileType(input.bytes, input.fileName);
  if (!detected) throw badRequest(`Unsupported file type. Allowed: ${ALLOWED_DESCRIPTION}.`);
  if (input.imagesOnly && detected.kind !== "image") throw badRequest("Please upload a photo (JPEG, PNG, WEBP or HEIC).");
  return detected;
}

/** Writes the bytes to private storage and creates Document + DocumentVersion(1). */
export async function storeDocument(db: Db, input: StoreInput) {
  const type = await validated(input);
  const fileName = sanitizeFileName(input.fileName);
  const doc = await db.document.create({
    data: {
      type: input.type,
      title: input.title?.slice(0, 200) || fileName,
      visibility: input.visibility ?? "INTERNAL",
      photoPhase: input.photoPhase ?? null,
      organizationId: input.organizationId ?? null,
      locationId: input.locationId ?? null,
      jobId: input.jobId ?? null,
      manifestId: input.manifestId ?? null,
      invoiceId: input.invoiceId ?? null,
      paymentId: input.paymentId ?? null,
      assetId: input.assetId ?? null,
      inspectionId: input.inspectionId ?? null,
      disposalEventId: input.disposalEventId ?? null,
      disposalBillId: input.disposalBillId ?? null,
      expenseId: input.expenseId ?? null,
      proposalId: input.proposalId ?? null,
      serviceReportId: input.serviceReportId ?? null,
      emergencyRequestId: input.emergencyRequestId ?? null,
      supportTicketId: input.supportTicketId ?? null,
      vehicleId: input.vehicleId ?? null,
      uploadedById: input.uploadedById,
    },
  });
  const storageKey = `documents/${doc.id}/v1-${randomToken(8)}.${type.ext}`;
  await storage().put(storageKey, input.bytes, type.mime);
  await db.documentVersion.create({
    data: {
      documentId: doc.id,
      version: 1,
      storageKey,
      fileName: fileName.includes(".") ? fileName : `${fileName}.${type.ext}`,
      mimeType: type.mime,
      sizeBytes: input.bytes.byteLength,
      sha256: sha256Hex(input.bytes),
      uploadedById: input.uploadedById,
    },
  });
  return doc;
}

/** Adds a new version; the previous file is preserved for history. */
export async function addDocumentVersion(actor: Actor, documentId: string, bytes: Uint8Array, fileName: string, note?: string) {
  if (!hasPermission(actor, "documents.write")) throw forbidden();
  const doc = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!doc) throw notFound();
  if (doc.type === "MANIFEST" || doc.type === "INVOICE" || doc.type === "RECEIPT") {
    throw badRequest("Generated documents are versioned through their manifest or invoice, not replaced directly.");
  }
  const type = await validated({ bytes, fileName, type: doc.type, uploadedById: actor.userId });
  const version = doc.currentVersion + 1;
  const storageKey = `documents/${doc.id}/v${version}-${randomToken(8)}.${type.ext}`;
  await storage().put(storageKey, bytes, type.mime);
  await prisma.$transaction(async (tx) => {
    await tx.documentVersion.create({
      data: { documentId: doc.id, version, storageKey, fileName: sanitizeFileName(fileName), mimeType: type.mime, sizeBytes: bytes.byteLength, sha256: sha256Hex(bytes), uploadedById: actor.userId, note: note ?? null },
    });
    await tx.document.update({ where: { id: doc.id }, data: { currentVersion: version } });
    await audit(tx, { actorId: actor.userId, action: "document.replace", entityType: "Document", entityId: doc.id, organizationId: doc.organizationId, before: { version: doc.currentVersion }, after: { version }, reason: note ?? null });
  });
}

export async function archiveDocument(actor: Actor, documentId: string, reason: string) {
  if (!hasPermission(actor, "documents.delete")) throw forbidden();
  const doc = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null } });
  if (!doc) throw notFound();
  if (doc.type === "MANIFEST" || doc.type === "INVOICE") throw badRequest("Manifest and invoice PDFs cannot be archived.");
  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: documentId }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "document.archive", entityType: "Document", entityId: documentId, organizationId: doc.organizationId, reason });
  });
}

/**
 * Central document authorization. Used by every download path (single file, preview, ZIP).
 * Returns the document when access is allowed; throws notFound otherwise (no existence leak).
 */
export async function authorizeDocument(actor: Actor, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw notFound();
  const doc = await prisma.document.findFirst({ where: { id: documentId, deletedAt: null }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!doc) throw notFound();
  if (actor.kind === "STAFF") {
    if (!hasPermission(actor, "documents.read")) throw notFound();
    return doc;
  }
  if (actor.kind === "DRIVER") {
    if (!actor.driverId) throw notFound();
    const ok =
      (doc.jobId && (await prisma.job.count({ where: { id: doc.jobId, driverId: actor.driverId } })) > 0) ||
      (doc.inspectionId && (await prisma.vehicleInspection.count({ where: { id: doc.inspectionId, driverId: actor.driverId } })) > 0) ||
      (doc.disposalEventId && (await prisma.disposalEvent.count({ where: { id: doc.disposalEventId, driverId: actor.driverId } })) > 0) ||
      (doc.uploadedById === actor.userId && doc.type === "SUPPORT_ATTACHMENT");
    if (!ok) throw notFound();
    return doc;
  }
  const scope = await customerScopeFor(actor);
  const visible = await prisma.document.count({ where: { AND: [{ id: doc.id }, documentScopedWhere(scope)] } });
  if (!visible) throw notFound();
  return doc;
}

export async function documentBytes(actor: Actor, documentId: string, version?: number) {
  const doc = await authorizeDocument(actor, documentId);
  const v = version ? doc.versions.find((x) => x.version === version) : doc.versions[0];
  if (!v) throw notFound();
  // Customers only ever receive the current version.
  if (actor.kind === "CUSTOMER" && v.version !== doc.currentVersion) throw notFound();
  return { doc, version: v };
}

export function customerDocumentsWhere(scope: Awaited<ReturnType<typeof customerScopeFor>>, selected: string | null, filters: { type?: DocumentType; q?: string }): Prisma.DocumentWhereInput {
  return {
    AND: [
      documentScopedWhere(scope, selected),
      filters.type ? { type: filters.type } : {},
      filters.q ? { title: { contains: filters.q, mode: "insensitive" } } : {},
    ],
  };
}

export async function readUploadedFile(file: FormDataEntryValue | null): Promise<{ bytes: Uint8Array; name: string } | null> {
  if (!file || typeof file === "string") return null;
  if (file.size === 0) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name || "upload" };
}

export type JobAttachmentKind = "BEFORE" | "AFTER" | "MANIFEST" | "DOCUMENT";

/**
 * Office uploads onto a job: before/after photos, a scanned or signed paper manifest, or any
 * other job document. Before/after photos follow the normal rule (published to the customer when
 * the job is approved) unless the job is already completed, in which case the toggle applies now.
 */
export async function attachJobFiles(actor: Actor, jobId: string, input: { kind: JobAttachmentKind; title?: string; visibleToCustomer: boolean }, files: { bytes: Uint8Array; name: string }[]) {
  if (actor.kind !== "STAFF" || !hasPermission(actor, "documents.write")) throw forbidden();
  if (files.length === 0) throw badRequest("Choose at least one file.");
  if (files.length > 10) throw badRequest("Upload up to 10 files at a time.");
  const job = await prisma.job.findUnique({ where: { id: jobId }, include: { manifest: true } });
  if (!job) throw notFound();
  if (input.kind === "MANIFEST" && !job.manifest && !["IN_PROGRESS", "PENDING_DOCUMENTATION", "SUBMITTED", "COMPLETED"].includes(job.status)) {
    throw badRequest("A manifest can be attached once the service has been performed.");
  }
  const isPhoto = input.kind === "BEFORE" || input.kind === "AFTER";
  const visibility: DocumentVisibility = input.visibleToCustomer && (!isPhoto || job.status === "COMPLETED") ? "CUSTOMER" : "INTERNAL";

  return prisma.$transaction(async (tx) => {
    const manifestId = input.kind === "MANIFEST" ? (job.manifest ?? (await (await import("./manifests")).ensureManifest(tx, jobId))).id : null;
    const docs = [];
    for (const [i, f] of files.entries()) {
      const label = input.title?.trim() || (isPhoto ? `${input.kind === "BEFORE" ? "Before" : "After"} photo` : input.kind === "MANIFEST" ? "Signed manifest (scan)" : "Job document");
      docs.push(
        await storeDocument(tx, {
          bytes: f.bytes,
          fileName: f.name,
          title: `${label}${files.length > 1 ? ` (${i + 1})` : ""} — ${job.jobNumber}`,
          type: isPhoto ? "SERVICE_PHOTO" : input.kind === "MANIFEST" ? "MANIFEST_OFFICIAL" : "OTHER",
          photoPhase: isPhoto ? input.kind as PhotoPhase : null,
          imagesOnly: isPhoto,
          visibility,
          organizationId: job.organizationId,
          locationId: job.locationId,
          jobId,
          manifestId,
          uploadedById: actor.userId,
        }),
      );
    }
    await audit(tx, { actorId: actor.userId, action: "job.files_attached", entityType: "Job", entityId: jobId, organizationId: job.organizationId, after: { kind: input.kind, count: docs.length, visibility, documentIds: docs.map((d) => d.id) } });
    return docs;
  }, { timeout: 60_000 });
}
