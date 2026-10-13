"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import * as jobs from "@/server/services/jobs";
import { approveJob, rejectJob, reviewJobCharge } from "@/server/services/field";
import * as er from "@/server/services/emergencies";
import * as fleet from "@/server/services/fleet";
import { disposalSchema, recordDisposal, facilitySchema, upsertFacility } from "@/server/services/disposal";
import { billSchema, billStatusSchema, createDisposalBill, setDisposalBillStatus } from "@/server/services/disposal-bills";
import { staffReply, updateTicket } from "@/server/services/support";
import { readUploadedFile } from "@/server/services/documents";
import { processDueDeliveries } from "@/server/services/notifications";
import { inviteUser, invitationResult } from "@/server/services/auth";
import { isUuid } from "@/server/params";
import { badRequest } from "@/server/errors";

const id = z.string().uuid();
const flush = () => after(() => processDueDeliveries());

const _createJob = formAction(jobs.jobSchema, async (input) => {
  const actor = await assertStaff("jobs.write");
  const jobId = await jobs.scheduleService(actor, input);
  flush();
  redirect(jobId ? `/admin/jobs/${jobId}?created=1` : "/admin/dispatch");
});
export async function createJobAction(p: ActionResult, fd: FormData) { return _createJob(p, fd); }

export async function assignJobAction(jobId: string, driverId: string | null, vehicleId: string | null, reason?: string) {
  return runAction(async () => {
    const actor = await assertStaff("jobs.dispatch");
    if (!isUuid(jobId) || (driverId && !isUuid(driverId)) || (vehicleId && !isUuid(vehicleId))) throw badRequest("Invalid selection.");
    await jobs.assignJob(actor, jobId, driverId, vehicleId, reason);
    flush();
    return null;
  });
}

export async function moveJobAction(jobId: string, date: string) {
  return runAction(async () => {
    const actor = await assertStaff("jobs.write");
    await jobs.moveJobDate(actor, jobId, date);
    flush();
    return null;
  });
}

export async function reorderRouteAction(driverId: string, date: string, ids: string[]) {
  return runAction(async () => jobs.reorderRoute(await assertStaff("jobs.dispatch"), driverId, date, ids));
}

const _reschedule = formAction(z.object({ jobId: id, date: z.string(), windowStart: z.string().optional(), windowEnd: z.string().optional(), reason: z.string().trim().min(3, "Give a reason."), keepDriver: z.enum(["on"]).optional() }), async (i) => {
  const actor = await assertStaff("jobs.write");
  await jobs.rescheduleJob(actor, i.jobId, { date: i.date, windowStart: i.windowStart || null, windowEnd: i.windowEnd || null, reason: i.reason, keepDriver: i.keepDriver === "on" });
  flush();
  return { ok: true, message: "Job rescheduled." };
});
export async function rescheduleJobAction(p: ActionResult, fd: FormData) { return _reschedule(p, fd); }

const _cancel = formAction(z.object({ jobId: id, reason: z.string().trim().min(3, "Give a reason.") }), async (i) => {
  const actor = await assertStaff("jobs.write");
  await jobs.cancelJob(actor, i.jobId, i.reason);
  flush();
  return { ok: true, message: "Job cancelled." };
});
export async function cancelJobAction(p: ActionResult, fd: FormData) { return _cancel(p, fd); }

const _missed = formAction(z.object({ jobId: id, note: z.string().trim().min(3) }), async (i) => {
  await jobs.markMissed(await assertStaff("jobs.write"), i.jobId, i.note);
  return { ok: true, message: "Marked as missed. Reschedule it when ready." };
});
export async function markMissedAction(p: ActionResult, fd: FormData) { return _missed(p, fd); }

const _details = formAction(z.object({ jobId: id, instructions: z.string().trim().max(4000).optional(), internalNotes: z.string().trim().max(4000).optional(), estimatedGallons: z.coerce.number().int().min(0).optional(), priority: z.enum(["NORMAL", "HIGH", "EMERGENCY"]).optional(), confirmedByOffice: z.enum(["on"]).optional() }), async (i) => {
  await jobs.updateJobDetails(await assertStaff("jobs.write"), i.jobId, { instructions: i.instructions ?? null, internalNotes: i.internalNotes ?? null, estimatedGallons: i.estimatedGallons ?? null, priority: i.priority, confirmedByOffice: i.confirmedByOffice === "on" });
  return { ok: true, message: "Job updated." };
});
export async function updateJobDetailsAction(p: ActionResult, fd: FormData) { return _details(p, fd); }

const _approve = formAction(z.object({ jobId: id, note: z.string().trim().max(1000).optional() }), async (i) => {
  const actor = await assertStaff("jobs.approve");
  const res = await approveJob(actor, i.jobId, i.note);
  flush();
  return { ok: true, message: res.invoiceId ? "Approved. Manifest finalized and invoice generated." : "Approved and manifest finalized." };
});
export async function approveJobAction(p: ActionResult, fd: FormData) { return _approve(p, fd); }

const _reject = formAction(z.object({ jobId: id, reason: z.string().trim().min(5, "Explain what needs to be corrected.") }), async (i) => {
  await rejectJob(await assertStaff("jobs.approve"), i.jobId, i.reason);
  flush();
  return { ok: true, message: "Sent back to the driver for correction." };
});
export async function rejectJobAction(p: ActionResult, fd: FormData) { return _reject(p, fd); }

export async function reviewChargeAction(chargeId: string, approve: boolean) {
  return runAction(async () => reviewJobCharge(await assertStaff(["jobs.approve", "invoices.write"]), chargeId, approve));
}

// ── Emergencies ──
export async function acknowledgeEmergencyAction(erId: string) {
  return runAction(async () => {
    await er.acknowledgeEmergency(await assertStaff("emergencies.manage"), erId);
    flush();
    return null;
  });
}
const _erStatus = formAction(z.object({ id, to: z.enum(["CONTACTING_CUSTOMER", "AWAITING_APPROVAL", "CANCELLED"]), note: z.string().trim().default("") }), async (i) => {
  await er.updateEmergencyStatus(await assertStaff("emergencies.manage"), i.id, i.to, i.note);
  flush();
  return { ok: true, message: "Status updated." };
});
export async function emergencyStatusAction(p: ActionResult, fd: FormData) { return _erStatus(p, fd); }

const _erTerms = formAction(z.object({ id, confirmedArrival: z.string().optional(), confirmedPrice: z.string().optional(), customerApproved: z.enum(["on"]).optional(), note: z.string().optional() }), async (i) => {
  await er.confirmEmergencyTerms(await assertStaff("emergencies.manage"), i.id, { ...i, customerApproved: i.customerApproved === "on" });
  return { ok: true, message: "Confirmed terms recorded." };
});
export async function emergencyTermsAction(p: ActionResult, fd: FormData) { return _erTerms(p, fd); }

const _erDispatch = formAction(z.object({ id, driverId: id, vehicleId: id, scheduledDate: z.string().optional(), windowStart: z.string().optional(), windowEnd: z.string().optional(), assetIds: z.array(id).default([]), instructions: z.string().optional() }), async (i) => {
  const actor = await assertStaff(["emergencies.manage"]);
  const job = await er.dispatchEmergency(actor, i.id, { ...i, windowStart: i.windowStart || undefined, windowEnd: i.windowEnd || undefined, scheduledDate: i.scheduledDate || undefined });
  flush();
  return { ok: true, message: `Dispatched as ${job.jobNumber}.` };
});
export async function dispatchEmergencyAction(p: ActionResult, fd: FormData) { return _erDispatch(p, fd); }

// ── Fleet ──
const _vehicle = formAction(fleet.vehicleSchema.and(z.object({ vehicleId: id.optional().or(z.literal("").transform(() => undefined)) })), async ({ vehicleId, ...input }) => {
  const v = await fleet.upsertVehicle(await assertStaff("fleet.write"), vehicleId ?? null, input);
  if (!vehicleId) redirect(`/admin/fleet/${v.id}`);
  return { ok: true, message: "Truck saved." };
});
export async function saveVehicleAction(p: ActionResult, fd: FormData) { return _vehicle(p, fd); }

const _maint = formAction(z.object({ vehicleId: id, performedOn: z.string(), category: z.string().trim().min(2), description: z.string().trim().min(3), cost: z.string().optional(), odometer: z.coerce.number().int().optional(), vendor: z.string().optional() }), async ({ vehicleId, ...i }) => {
  await fleet.addMaintenance(await assertStaff("fleet.write"), vehicleId, i);
  return { ok: true, message: "Maintenance recorded." };
});
export async function addMaintenanceAction(p: ActionResult, fd: FormData) { return _maint(p, fd); }

const _driver = formAction(fleet.driverSchema.and(z.object({ driverId: id })), async ({ driverId, ...i }) => {
  await fleet.updateDriver(await assertStaff("fleet.write"), driverId, i);
  return { ok: true, message: "Driver updated." };
});
export async function updateDriverAction(p: ActionResult, fd: FormData) { return _driver(p, fd); }

const _inviteDriver = formAction(z.object({ email: z.string().trim().email(), name: z.string().trim().min(2), phone: z.string().trim().optional() }), async (i) => {
  const { token } = await inviteUser(await assertStaff("staff.manage"), { kind: "DRIVER", roleKey: "driver", ...i });
  flush();
  return invitationResult(i.email, token);
});
export async function inviteDriverAction(p: ActionResult, fd: FormData) { return _inviteDriver(p, fd); }

const _issue = formAction(z.object({ issueId: id, status: z.enum(["ACKNOWLEDGED", "RESOLVED"]), resolution: z.string().optional() }), async (i) => {
  await fleet.resolveIssue(await assertStaff(["fleet.write", "jobs.dispatch"]), i.issueId, i.status, i.resolution);
  return { ok: true, message: "Issue updated." };
});
export async function resolveIssueAction(p: ActionResult, fd: FormData) { return _issue(p, fd); }

// ── Disposal ──
const _disposal = formAction(disposalSchema, async (input, fd) => {
  await recordDisposal(await assertStaff("disposal.write"), input, await readUploadedFile(fd.get("ticket")));
  return { ok: true, message: "Disposal event recorded." };
});
export async function recordDisposalAdminAction(p: ActionResult, fd: FormData) { return _disposal(p, fd); }

const _facility = formAction(facilitySchema.and(z.object({ facilityId: id.optional().or(z.literal("").transform(() => undefined)) })), async ({ facilityId, ...i }) => {
  await upsertFacility(await assertStaff(["settings.write", "disposal.write"]), facilityId ?? null, i);
  return { ok: true, message: "Facility saved." };
});
export async function saveFacilityAction(p: ActionResult, fd: FormData) { return _facility(p, fd); }

const _bill = formAction(billSchema, async (input, fd) => {
  const bill = await createDisposalBill(await assertStaff("disposal.write"), input, await readUploadedFile(fd.get("file")));
  return { ok: true, message: `Bill ${bill.vendorInvoiceNumber} saved.` };
});
export async function createDisposalBillAction(p: ActionResult, fd: FormData) { return _bill(p, fd); }

const _billStatus = formAction(billStatusSchema, async (input) => {
  await setDisposalBillStatus(await assertStaff("disposal.write"), input);
  return { ok: true, message: input.status === "PAID" ? "Marked paid." : input.status === "VOID" ? "Bill voided." : "Bill re-opened." };
});
export async function setDisposalBillStatusAction(p: ActionResult, fd: FormData) { return _billStatus(p, fd); }

// ── Support ──
const _reply = formAction(z.object({ ticketId: id, body: z.string().trim().min(1).max(5000), internal: z.enum(["on"]).optional(), status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"]).optional() }), async (i) => {
  await staffReply(await assertStaff("support.manage"), i.ticketId, { body: i.body, internal: i.internal === "on", status: i.status });
  flush();
  return { ok: true, message: i.internal ? "Internal note added." : "Reply sent to the customer." };
});
export async function staffReplyAction(p: ActionResult, fd: FormData) { return _reply(p, fd); }

const _ticket = formAction(z.object({ ticketId: id, status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"]), assignedToId: id.optional().or(z.literal("").transform(() => undefined)), jobId: id.optional().or(z.literal("").transform(() => undefined)), invoiceId: id.optional().or(z.literal("").transform(() => undefined)) }), async (i) => {
  await updateTicket(await assertStaff("support.manage"), i.ticketId, { status: i.status, assignedToId: i.assignedToId ?? null, jobId: i.jobId ?? null, invoiceId: i.invoiceId ?? null });
  return { ok: true, message: "Inquiry updated." };
});
export async function updateTicketAction(p: ActionResult, fd: FormData) { return _ticket(p, fd); }
