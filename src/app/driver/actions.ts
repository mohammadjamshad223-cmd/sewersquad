"use server";

import { after } from "next/server";
import { z } from "zod";
import { assertDriver } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { requestMeta } from "@/server/auth/request";
import { driverTransition } from "@/server/services/jobs";
import { addJobCharge, deleteJobPhoto, issueSchema, reportIssue, saveServiceDraft, serviceDraftSchema, submitService, submitSchema, uploadJobPhoto, uploadCityManifest, submissionProblems } from "@/server/services/field";
import { inspectionSchema, submitInspection, DEFAULT_INSPECTION_ITEMS } from "@/server/services/fleet";
import { disposalSchema, recordDisposal } from "@/server/services/disposal";
import { readUploadedFile } from "@/server/services/documents";
import { processDueDeliveries } from "@/server/services/notifications";
import { badRequest } from "@/server/errors";
import { prisma } from "@/server/db";
import { isUuid } from "@/server/params";

const flush = () => after(() => processDueDeliveries());

export async function jobTransitionAction(jobId: string, to: "ACCEPTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "UNABLE_TO_SERVICE", extra: { note?: string; latitude?: number | null; longitude?: number | null } = {}) {
  return runAction(async () => {
    const actor = await assertDriver();
    if (!isUuid(jobId)) throw badRequest("Invalid job.");
    await driverTransition(actor, jobId, to, extra);
    flush();
    return to;
  });
}

/** Draft save from the completion wizard (JSON payload — also used when syncing offline drafts). */
export async function saveDraftAction(jobId: string, draft: unknown) {
  return runAction(async () => {
    const actor = await assertDriver();
    if (!isUuid(jobId)) throw badRequest("Invalid job.");
    const parsed = serviceDraftSchema.parse(draft);
    return saveServiceDraft(actor, jobId, parsed);
  });
}

export async function uploadPhotoAction(fd: FormData) {
  return runAction(async () => {
    const actor = await assertDriver();
    const jobId = String(fd.get("jobId") ?? "");
    const phase = String(fd.get("phase") ?? "");
    if (!isUuid(jobId) || !["BEFORE", "AFTER", "ISSUE", "CITY_MANIFEST"].includes(phase)) throw badRequest("Invalid upload.");
    const file = await readUploadedFile(fd.get("file"));
    if (!file) throw badRequest("Choose a photo.");
    if (phase === "CITY_MANIFEST") return { id: (await uploadCityManifest(actor, jobId, file)).id };
    const assetId = fd.get("assetId");
    const doc = await uploadJobPhoto(actor, jobId, phase as "BEFORE" | "AFTER" | "ISSUE", file, isUuid(assetId) ? assetId : null);
    return { id: doc.id };
  });
}

export async function deletePhotoAction(jobId: string, documentId: string) {
  return runAction(async () => {
    const actor = await assertDriver();
    await deleteJobPhoto(actor, jobId, documentId);
    return null;
  });
}

export async function submissionCheckAction(jobId: string) {
  return runAction(async () => {
    const actor = await assertDriver();
    if (!(await prisma.job.count({ where: { id: jobId, driverId: actor.driverId } }))) throw badRequest("Not found");
    return submissionProblems(prisma, jobId);
  });
}

const _submit = formAction(submitSchema.and(z.object({ jobId: z.string().uuid() })), async (input) => {
  const actor = await assertDriver();
  const meta = await requestMeta();
  await submitService(actor, input.jobId, input, { ip: meta.ip });
  flush();
  return { ok: true, message: "Job submitted for review." };
});
export async function submitJobAction(prev: ActionResult, fd: FormData) {
  return _submit(prev, fd);
}

const _charge = formAction(z.object({ jobId: z.string().uuid(), kind: z.string(), description: z.string().trim().min(3).max(300), quantity: z.string().trim(), unitPrice: z.string().trim() }), async (input) => {
  const actor = await assertDriver();
  await addJobCharge(actor, input.jobId, input);
  return { ok: true, message: "Charge added — pending office approval." };
});
export async function addChargeAction(prev: ActionResult, fd: FormData) {
  return _charge(prev, fd);
}

const _issue = formAction(issueSchema, async (input) => {
  const actor = await assertDriver();
  await reportIssue(actor, input);
  flush();
  return { ok: true, message: "Issue reported to the office." };
});
export async function reportIssueAction(prev: ActionResult, fd: FormData) {
  return _issue(prev, fd);
}

export async function submitInspectionAction(prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertDriver();
    const items = DEFAULT_INSPECTION_ITEMS.map((i) => ({ key: i.key, label: i.label, result: String(fd.get(`item:${i.key}`) ?? "PASS") as "PASS" | "FAIL" | "NA", note: String(fd.get(`note:${i.key}`) ?? "") || undefined }));
    const input = inspectionSchema.parse({
      vehicleId: fd.get("vehicleId"),
      type: fd.get("type"),
      odometer: fd.get("odometer") || null,
      items,
      comments: fd.get("comments") || undefined,
      acknowledgedBy: fd.get("acknowledgedBy"),
    });
    const photos = [];
    for (const f of fd.getAll("photos")) {
      const r = await readUploadedFile(f);
      if (r) photos.push(r);
    }
    await submitInspection(actor, input, photos);
    flush();
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Inspection recorded." } : r));
}

const _disposal = formAction(disposalSchema, async (input, fd) => {
  const actor = await assertDriver();
  await recordDisposal(actor, input, await readUploadedFile(fd.get("ticket")));
  return { ok: true, message: "Disposal recorded." };
});
export async function recordDisposalAction(prev: ActionResult, fd: FormData) {
  return _disposal(prev, fd);
}
