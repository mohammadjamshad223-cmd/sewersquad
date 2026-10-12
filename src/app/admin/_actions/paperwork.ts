"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { createProposal, proposalSchema, proposalStatusSchema, setProposalStatus, updateProposal } from "@/server/services/proposals";
import { createReport, finalizeReport, reportSchema, updateReport } from "@/server/services/service-reports";
import { runImportStep, PHASES, type ImportStep } from "@/server/services/records-import";
import { isUuid } from "@/server/params";
import { badRequest } from "@/server/errors";

const withId = (key: string) => z.object({ [key]: z.string().uuid().optional().or(z.literal("").transform(() => undefined)) });

const _proposal = formAction(proposalSchema.and(withId("proposalId")), async (input) => {
  const actor = await assertStaff("invoices.write");
  const { proposalId, ...rest } = input as typeof input & { proposalId?: string };
  const p = proposalId ? await updateProposal(actor, proposalId, rest) : await createProposal(actor, rest);
  if (!proposalId) redirect(`/admin/proposals/${p.id}?created=1`);
  return { ok: true, message: "Saved." };
});
export async function saveProposalAction(p: ActionResult, fd: FormData) { return _proposal(p, fd); }

const _proposalStatus = formAction(proposalStatusSchema, async (input) => {
  await setProposalStatus(await assertStaff("invoices.write"), input);
  return { ok: true, message: input.status === "SENT" ? "Marked sent. The PDF is filed with the customer's documents." : input.status === "ACCEPTED" ? "Marked accepted." : input.status === "DECLINED" ? "Marked declined." : "Back to draft." };
});
export async function setProposalStatusAction(p: ActionResult, fd: FormData) { return _proposalStatus(p, fd); }

const _report = formAction(reportSchema.and(withId("reportId")), async (input) => {
  const actor = await assertStaff("jobs.write");
  const { reportId, ...rest } = input as typeof input & { reportId?: string };
  const r = reportId ? await updateReport(actor, reportId, rest) : await createReport(actor, rest);
  if (!reportId) redirect(`/admin/service-reports/${r.id}?created=1`);
  return { ok: true, message: "Saved." };
});
export async function saveReportAction(p: ActionResult, fd: FormData) { return _report(p, fd); }

export async function finalizeReportAction(reportId: string) {
  return runAction(async () => {
    if (!isUuid(reportId)) throw badRequest("Invalid report.");
    await finalizeReport(await assertStaff("jobs.write"), reportId);
    return null;
  });
}

const optionsSchema = z.object({ unpaid: z.array(z.string().regex(/^\d{3}$/)).max(100), applyCompany: z.boolean(), createPlans: z.boolean() });
const stepSchema = z.object({ phase: z.enum(PHASES), cursor: z.number().int().min(0).max(1000) });

export async function importStepAction(options: unknown, step: unknown) {
  return runAction(async () => runImportStep(await assertStaff("settings.write"), optionsSchema.parse(options), stepSchema.parse(step) as ImportStep));
}
