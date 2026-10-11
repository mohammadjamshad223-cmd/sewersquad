import { idParam } from "@/server/params";
import { notFound, redirect } from "next/navigation";
import { requireDriverPage } from "@/server/authz/guards";
import { driverJob } from "@/server/services/driver-portal";
import { AppError } from "@/server/errors";
import { WASTE_TYPES, ASSET_TYPE_LABEL } from "@/lib/status";
import { CompletionWizard } from "./wizard";

export const metadata = { title: "Complete job" };

export default async function CompletePage({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const actor = await requireDriverPage();
  let data;
  try {
    data = await driverJob(actor.driverId, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { job, otherAssets } = data;
  if (!["ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"].includes(job.status)) redirect(`/driver/jobs/${id}`);
  const rec = job.serviceRecord;
  const label = (a: { type: string; customTypeLabel: string | null }) => (a.type === "OTHER" && a.customTypeLabel ? a.customTypeLabel : ASSET_TYPE_LABEL[a.type] ?? a.type);
  return (
    <CompletionWizard
      job={{ id: job.id, jobNumber: job.jobNumber, status: job.status, locationName: job.location.name, address: `${job.location.addressLine1}, ${job.location.city}`, instructions: [job.instructions, job.plan?.specialInstructions, job.location.accessInstructions].filter(Boolean).join("\n"), driverName: actor.name, truck: job.vehicle?.unitNumber ?? null, rejection: job.manifest?.status === "REJECTED" ? job.manifest.rejectionReason : null }}
      assets={[...job.assets.map((a) => ({ ...a.asset, label: label(a.asset), planned: true })), ...otherAssets.map((a) => ({ ...a, label: label(a), planned: false }))]}
      wasteTypes={[...WASTE_TYPES]}
      photos={job.documents.map((d) => ({ id: d.id, phase: d.photoPhase ?? "ISSUE", url: `/api/documents/${d.id}` }))}
      charges={job.charges.map((c) => ({ id: c.id, description: c.description, status: c.status }))}
      server={{
        clientVersion: rec?.clientDraftVersion ?? 0,
        draft: rec
          ? {
              conditionBefore: rec.conditionBefore ?? "",
              accessIssues: rec.accessIssues ?? "",
              unusualConditions: rec.unusualConditions ?? "",
              conditionAfter: rec.conditionAfter ?? "",
              issuesFound: rec.issuesFound ?? "",
              followUpRecommendations: rec.followUpRecommendations ?? "",
              additionalWork: rec.additionalWork ?? "",
              wasteType: rec.wasteType ?? "",
              notes: rec.notes ?? "",
              startedAt: rec.startedAt?.toISOString() ?? null,
              // Nothing recorded yet → start from the equipment planned for this job.
              assets: rec.assetRecords.length
                ? rec.assetRecords.map((a) => ({ assetId: a.assetId, gallonsPumped: String(a.gallonsPumped), servicePerformed: a.servicePerformed ?? "", conditionAfter: a.conditionAfter ?? "" }))
                : job.assets.map((a) => ({ assetId: a.assetId, gallonsPumped: "", servicePerformed: "Full pump-out", conditionAfter: "" })),
            }
          : null,
      }}
    />
  );
}
