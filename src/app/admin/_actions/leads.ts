"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { addLeadNote, createLead, leadSchema, logLeadContact, setLeadStatus, type ContactMethod } from "@/server/services/leads";
import { isUuid } from "@/server/params";
import { badRequest } from "@/server/errors";

const _create = formAction(leadSchema, async (input) => {
  const lead = await createLead(await assertStaff("support.manage"), input);
  redirect(`/admin/leads/${lead.id}`);
});
export async function createLeadAction(p: ActionResult, fd: FormData) { return _create(p, fd); }

export async function logLeadContactAction(leadId: string, method: ContactMethod, note?: string) {
  return runAction(async () => {
    if (!isUuid(leadId)) throw badRequest("Invalid lead.");
    await logLeadContact(await assertStaff("support.manage"), leadId, method, note);
    return null;
  });
}

export async function setLeadStatusAction(leadId: string, status: "NEW" | "CONTACTED" | "QUOTED" | "WON" | "LOST") {
  return runAction(async () => {
    if (!isUuid(leadId) || !["NEW", "CONTACTED", "QUOTED", "WON", "LOST"].includes(status)) throw badRequest("Invalid.");
    await setLeadStatus(await assertStaff("support.manage"), leadId, status);
    return null;
  });
}

const _note = formAction(z.object({ leadId: z.string().uuid(), body: z.string().max(5000).optional().default(""), followUp: z.string().optional() }), async (i) => {
  await addLeadNote(await assertStaff("support.manage"), i.leadId, i.body, i.followUp === undefined ? undefined : i.followUp || null);
  return { ok: true, message: "Saved." };
});
export async function addLeadNoteAction(p: ActionResult, fd: FormData) { return _note(p, fd); }
