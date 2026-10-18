"use server";

import { after } from "next/server";
import { assertStaff } from "@/server/authz/guards";
import { formDataToObject, runAction } from "@/server/action";
import { requestMeta } from "@/server/auth/request";
import { readUploadedFile } from "@/server/services/documents";
import { completeJobFromBoard, completeJobSchema, sendCompletionPackage, type CompletionResult } from "@/server/services/job-completion";
import { processDueDeliveries } from "@/server/services/notifications";
import { isUuid } from "@/server/params";
import { badRequest } from "@/server/errors";

const flush = () => after(() => processDueDeliveries());
const PHASES = ["BEFORE", "AFTER", "CITY_MANIFEST"] as const;

/** "Completed" on the dispatch board: document the visit and finalize the manifest. The invoice is confirmed next. */
export async function completeJobAction(fd: FormData) {
  return runAction<{ jobId: string }>(async () => {
    const actor = await assertStaff("jobs.approve");
    const input = completeJobSchema.parse(formDataToObject(fd));
    const photos: { bytes: Uint8Array; name: string; phase: (typeof PHASES)[number] }[] = [];
    for (const phase of PHASES) {
      for (const f of fd.getAll(`photo_${phase}`)) {
        const file = await readUploadedFile(f);
        if (file) photos.push({ ...file, phase });
      }
    }
    if (photos.length > 12) throw badRequest("Add up to 12 photos at a time.");
    const meta = await requestMeta();
    const res = await completeJobFromBoard(actor, input, photos, { ip: meta.ip ?? null });
    flush();
    return res;
  });
}

export async function resendCompletionAction(jobId: string) {
  return runAction<CompletionResult>(async () => {
    const actor = await assertStaff(["jobs.approve", "invoices.write"]);
    if (!isUuid(jobId)) throw badRequest("Invalid job.");
    const res = await sendCompletionPackage(actor, jobId, { resend: true });
    flush();
    return res;
  });
}
