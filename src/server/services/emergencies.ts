import "server-only";
import { z } from "zod";
import type { EmergencyStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { assertLocationInScope, canEditForOrg, customerScopeFor } from "../authz/scope";
import { rateLimit } from "../auth/rate-limit";
import { canTransitionEmergency } from "@/domain/job-state";
import { EMERGENCY_CATEGORY_LABEL, EMERGENCY_STATUS } from "@/lib/status";
import { formatInstant, todayKey } from "@/lib/dates";
import { parseDollarsToCents, formatCents } from "@/lib/money";
import { customerRecipientsForLocation, notify, staffWithPermission } from "./notifications";
import { storeDocument } from "./documents";
import { createJob } from "./jobs";
import { companyTimeZone } from "./settings";

export const emergencySchema = z.object({
  locationId: z.string().uuid("Select a location."),
  contactName: z.string().trim().min(2, "Enter a contact name.").max(120),
  contactPhone: z.string().trim().min(7, "Enter a phone number.").max(40).regex(/^[\d+().\-\s x]+$/, "Use digits and + ( ) - only."),
  contactEmail: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  preferredContact: z.enum(["PHONE", "SMS", "EMAIL"]),
  serviceType: z.enum(["GREASE_TRAP_PUMPING", "INTERCEPTOR_PUMPING", "SEPTIC_PUMPING", "GRIT_TRAP_CLEANING", "LINT_TRAP_CLEANING", "LIFT_STATION_SERVICE", "HYDRO_JETTING", "LINE_CLEANING", "INSPECTION", "OTHER"]),
  category: z.enum(["TRAP_OVERFLOWING", "DRAIN_BACKUP", "INTERCEPTOR_FULL", "URGENT_PUMPING", "SEPTIC_ISSUE", "GRIT_WASTEWATER", "OTHER"]),
  severity: z.enum(["URGENT", "HIGH", "STANDARD"]),
  description: z.string().trim().min(10, "Describe what is happening (at least 10 characters).").max(4000),
  requestedTiming: z.enum(["ASAP", "TODAY", "NEXT_BUSINESS_DAY", "SPECIFIC_TIME"]),
  requestedFor: z.string().optional(),
});

export async function submitEmergency(actor: Actor, input: z.infer<typeof emergencySchema>, files: { bytes: Uint8Array; name: string }[]) {
  const scope = await customerScopeFor(actor);
  assertLocationInScope(scope, input.locationId);
  const loc = await prisma.serviceLocation.findUniqueOrThrow({ where: { id: input.locationId } });
  if (!canEditForOrg(scope, loc.organizationId)) throw badRequest("Read-only users cannot submit requests. Call us instead.");
  await rateLimit(`emergency:${actor.userId}`, 10, 3600);
  const requestedFor = input.requestedTiming === "SPECIFIC_TIME" && input.requestedFor ? new Date(input.requestedFor) : null;
  if (requestedFor && Number.isNaN(requestedFor.getTime())) throw badRequest("Enter a valid requested time.");

  return prisma.$transaction(
    async (tx) => {
      const er = await tx.emergencyRequest.create({
        data: {
          requestNumber: await numbers.emergency(tx),
          organizationId: loc.organizationId,
          locationId: loc.id,
          submittedById: actor.userId,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          contactEmail: input.contactEmail ?? null,
          preferredContact: input.preferredContact,
          serviceType: input.serviceType,
          category: input.category,
          severity: input.severity,
          description: input.description,
          requestedTiming: input.requestedTiming,
          requestedFor,
          isDemo: loc.isDemo,
          events: { create: { toStatus: "SUBMITTED", actorId: actor.userId, note: "Request submitted online" } },
        },
      });
      for (const f of files.slice(0, 6)) {
        await storeDocument(tx, { bytes: f.bytes, fileName: f.name, type: "SERVICE_PHOTO", photoPhase: "ISSUE", title: `Emergency ${er.requestNumber} photo`, visibility: "CUSTOMER", organizationId: loc.organizationId, locationId: loc.id, emergencyRequestId: er.id, uploadedById: actor.userId, imagesOnly: true });
      }
      await audit(tx, { actorId: actor.userId, action: "emergency.submit", entityType: "EmergencyRequest", entityId: er.id, organizationId: loc.organizationId, after: input });
      await notify(tx, {
        userIds: await staffWithPermission(tx, "emergencies.manage"),
        type: "admin.emergency",
        title: `${input.severity === "URGENT" ? "URGENT " : ""}Emergency request ${er.requestNumber}`,
        body: `${loc.name}: ${EMERGENCY_CATEGORY_LABEL[input.category]}. Contact ${input.contactName} at ${input.contactPhone}.`,
        link: `/admin/emergencies/${er.id}`,
        entityType: "EmergencyRequest",
        entityId: er.id,
        dedupeKey: `emergency:${er.id}:new`,
      });
      await notify(tx, {
        userIds: [actor.userId],
        type: "emergency.update",
        title: `We received emergency request ${er.requestNumber}`,
        body: "Our dispatch team will review your request and contact you to confirm timing and pricing. Submission does not guarantee immediate dispatch — for an active overflow, please also call us.",
        link: `/customer/request-service/${er.id}`,
        entityType: "EmergencyRequest",
        entityId: er.id,
        dedupeKey: `emergency:${er.id}:received`,
      });
      return er;
    },
    { timeout: 30_000 },
  );
}

async function transition(actorId: string, id: string, to: EmergencyStatus, note: string | null, customerVisible = true) {
  return prisma.$transaction(async (tx) => {
    const er = await tx.emergencyRequest.findUnique({ where: { id } });
    if (!er) throw notFound();
    if (!canTransitionEmergency(er.status, to)) throw badRequest(`Cannot move from ${EMERGENCY_STATUS[er.status]?.label} to ${EMERGENCY_STATUS[to]?.label}.`);
    await tx.emergencyRequest.update({
      where: { id },
      data: { status: to, ...(to === "ACKNOWLEDGED" && !er.acknowledgedAt ? { acknowledgedAt: new Date(), acknowledgedById: actorId } : {}), ...(to === "CANCELLED" ? { cancellationReason: note, closedAt: new Date() } : {}) },
    });
    await tx.emergencyRequestEvent.create({ data: { emergencyRequestId: id, fromStatus: er.status, toStatus: to, actorId, note, customerVisible } });
    await audit(tx, { actorId, action: `emergency.${to.toLowerCase()}`, entityType: "EmergencyRequest", entityId: id, organizationId: er.organizationId, before: { status: er.status }, after: { status: to }, reason: note });
    if (customerVisible && er.submittedById) {
      await notify(tx, {
        userIds: [er.submittedById, ...(await customerRecipientsForLocation(tx, er.organizationId, er.locationId))],
        type: "emergency.update",
        title: `Emergency ${er.requestNumber}: ${EMERGENCY_STATUS[to]?.label}`,
        body: note ?? "Your request status was updated.",
        link: `/customer/request-service/${id}`,
        entityType: "EmergencyRequest",
        entityId: id,
        dedupeKey: `emergency:${id}:${to}:${Date.now()}`,
      });
    }
    return er;
  });
}

export async function acknowledgeEmergency(actor: Actor, id: string) {
  assertStaffActor(actor, "emergencies.manage");
  return transition(actor.userId, id, "ACKNOWLEDGED", "Dispatch has received your request and is reviewing it.");
}

export async function updateEmergencyStatus(actor: Actor, id: string, to: "CONTACTING_CUSTOMER" | "AWAITING_APPROVAL" | "CANCELLED", note: string) {
  assertStaffActor(actor, "emergencies.manage");
  if (to === "CANCELLED" && note.trim().length < 3) throw badRequest("A reason is required to cancel.");
  return transition(actor.userId, id, to, note || null);
}

/** Record the timing and price the dispatcher confirmed with the customer. Nothing is promised before this. */
export async function confirmEmergencyTerms(actor: Actor, id: string, input: { confirmedArrival?: string; confirmedPrice?: string; customerApproved: boolean; note?: string }) {
  assertStaffActor(actor, "emergencies.manage");
  const arrival = input.confirmedArrival ? new Date(input.confirmedArrival) : null;
  if (arrival && Number.isNaN(arrival.getTime())) throw badRequest("Invalid arrival time.");
  const price = input.confirmedPrice ? parseDollarsToCents(input.confirmedPrice) : null;
  if (input.confirmedPrice && price === null) throw badRequest("Enter a valid price.");
  const tz = await companyTimeZone();
  await prisma.$transaction(async (tx) => {
    const er = await tx.emergencyRequest.findUnique({ where: { id } });
    if (!er) throw notFound();
    await tx.emergencyRequest.update({ where: { id }, data: { confirmedArrival: arrival, confirmedPriceCents: price, customerApprovedAt: input.customerApproved ? new Date() : null, internalNotes: input.note ? [er.internalNotes, input.note].filter(Boolean).join("\n") : er.internalNotes } });
    await tx.emergencyRequestEvent.create({
      data: {
        emergencyRequestId: id,
        fromStatus: er.status,
        toStatus: er.status,
        actorId: actor.userId,
        note: [arrival ? `Confirmed arrival: ${formatInstant(arrival, tz)}` : null, price !== null ? `Confirmed price: ${formatCents(price)}` : null, input.customerApproved ? "Customer approved" : "Awaiting customer approval"].filter(Boolean).join(" · "),
      },
    });
    await audit(tx, { actorId: actor.userId, action: "emergency.confirm_terms", entityType: "EmergencyRequest", entityId: id, organizationId: er.organizationId, after: { confirmedArrival: arrival, confirmedPriceCents: price, customerApproved: input.customerApproved } });
  });
}

/** Convert the request into a dispatched emergency job (requires customer approval of terms). */
export async function dispatchEmergency(actor: Actor, id: string, input: { driverId: string; vehicleId: string; scheduledDate?: string; windowStart?: string; windowEnd?: string; assetIds: string[]; instructions?: string }) {
  assertStaffActor(actor, ["emergencies.manage"]);
  assertStaffActor(actor, ["jobs.dispatch"]);
  const tz = await companyTimeZone();
  return prisma.$transaction(
    async (tx) => {
      const er = await tx.emergencyRequest.findUnique({ where: { id } });
      if (!er) throw notFound();
      if (er.jobId) throw badRequest("This request has already been dispatched.");
      if (!er.customerApprovedAt) throw badRequest("Record the customer's approval of timing and pricing before dispatching.");
      if (!canTransitionEmergency(er.status, "DISPATCHED")) throw badRequest("This request cannot be dispatched from its current status.");
      const job = await createJob(
        actor,
        {
          locationId: er.locationId,
          serviceType: er.serviceType,
          type: "EMERGENCY",
          priority: "EMERGENCY",
          scheduledDate: input.scheduledDate ?? todayKey(tz),
          windowStart: input.windowStart ?? null,
          windowEnd: input.windowEnd ?? null,
          assetIds: input.assetIds,
          driverId: input.driverId,
          vehicleId: input.vehicleId,
          instructions: [`EMERGENCY ${er.requestNumber}: ${EMERGENCY_CATEGORY_LABEL[er.category]}`, er.description, input.instructions].filter(Boolean).join("\n\n"),
          internalNotes: er.internalNotes ?? undefined,
          quotedPrice: er.confirmedPriceCents !== null ? (er.confirmedPriceCents / 100).toFixed(2) : undefined,
          estimatedGallons: null,
        },
        { db: tx },
      );
      await tx.emergencyRequest.update({ where: { id }, data: { jobId: job.id, status: "DISPATCHED" } });
      await tx.emergencyRequestEvent.create({ data: { emergencyRequestId: id, fromStatus: er.status, toStatus: "DISPATCHED", actorId: actor.userId, note: "A driver and truck have been assigned." } });
      await tx.document.updateMany({ where: { emergencyRequestId: id }, data: { jobId: job.id } });
      await audit(tx, { actorId: actor.userId, action: "emergency.dispatch", entityType: "EmergencyRequest", entityId: id, organizationId: er.organizationId, after: { jobId: job.id, driverId: input.driverId, vehicleId: input.vehicleId } });
      if (er.submittedById) {
        await notify(tx, { userIds: [er.submittedById], type: "emergency.update", title: `Emergency ${er.requestNumber}: dispatched`, body: "A driver and truck have been assigned. You can track progress in the portal.", link: `/customer/request-service/${id}`, entityType: "EmergencyRequest", entityId: id, dedupeKey: `emergency:${id}:dispatched` });
      }
      return job;
    },
    { timeout: 30_000 },
  );
}
