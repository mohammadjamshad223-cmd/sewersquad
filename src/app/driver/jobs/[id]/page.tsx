import { idParam } from "@/server/params";
import { notFound } from "next/navigation";
import { requireDriverPage } from "@/server/authz/guards";
import { driverJob } from "@/server/services/driver-portal";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { JobActions } from "@/components/driver/job-actions";
import { formatDateKey, formatInstant, formatWindow } from "@/lib/dates";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL, JOB_STATUS } from "@/lib/status";
import { formatAddress } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Job details" };

export default async function DriverJobDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const actor = await requireDriverPage();
  let data;
  try {
    data = await driverJob(actor.driverId, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { job, history } = data;
  const tz = await companyTimeZone();
  const address = formatAddress(job.location);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">{job.jobNumber}</p>
          <StatusBadge kind="job" status={job.status} />
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{job.location.name}</h1>
        <p className="text-[15px] text-muted-foreground">{address}</p>
        <p className="mt-1 text-[15px]"><span className="font-medium">{formatDateKey(job.scheduledDate, "weekday")}</span> · {formatWindow(job.windowStart, job.windowEnd)}</p>
      </div>
      {job.priority === "EMERGENCY" && <Alert tone="danger" title="Emergency dispatch">Confirmed with the customer by the office.</Alert>}
      {job.manifest?.status === "REJECTED" && <Alert tone="danger" title="Correction requested">{job.manifest.rejectionReason}</Alert>}
      <JobActions jobId={job.id} status={job.status} address={address} phone={job.location.siteContactPhone ?? job.organization.primaryPhone} />

      {(job.instructions || job.plan?.specialInstructions || job.location.accessInstructions || job.location.specialRequirements) && (
        <Card className="border-warning/30">
          <CardHeader title="Instructions" />
          <CardBody className="space-y-2 text-[15px]">
            {job.instructions && <p className="whitespace-pre-wrap">{job.instructions}</p>}
            {job.plan?.specialInstructions && <p>{job.plan.specialInstructions}</p>}
            {job.location.accessInstructions && <p><span className="font-medium">Access: </span>{job.location.accessInstructions}</p>}
            {job.location.specialRequirements && <p><span className="font-medium">Requirements: </span>{job.location.specialRequirements}</p>}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Equipment" />
        <CardBody className="divide-y p-0">
          {job.assets.map(({ asset }) => (
            <div key={asset.id} className="px-5 py-3">
              <p className="text-[15px] font-medium">{asset.type === "OTHER" && asset.customTypeLabel ? asset.customTypeLabel : ASSET_TYPE_LABEL[asset.type]} · {asset.capacityGallons.toLocaleString()} gal</p>
              <p className="text-[13px] text-muted-foreground">{asset.assetTag}{asset.installLocation ? ` · ${asset.installLocation}` : ""}</p>
            </div>
          ))}
          {job.assets.length === 0 && <p className="px-5 py-3 text-sm text-muted-foreground">No equipment listed — record what you service.</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Site contact" />
        <CardBody className="text-[15px]">{job.location.siteContactName ?? "—"} {job.location.siteContactPhone && <a className="ml-2 font-medium text-brand" href={`tel:${job.location.siteContactPhone.replace(/[^\d+]/g, "")}`}>{job.location.siteContactPhone}</a>}</CardBody>
      </Card>
      <Card>
        <CardHeader title="Previous service" />
        <CardBody className="space-y-3 text-[14px]">
          {history.length === 0 && <p className="text-muted-foreground">No prior service recorded.</p>}
          {history.map((h) => (
            <div key={h.id}>
              <p className="font-medium">{h.serviceRecord.finishedAt ? formatInstant(h.serviceRecord.finishedAt, tz, "date") : "—"} · {h.asset.assetTag} · {h.gallonsPumped.toLocaleString()} gal</p>
              {h.serviceRecord.conditionAfter && <p className="text-muted-foreground">{h.serviceRecord.conditionAfter}</p>}
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Activity" />
        <CardBody>
          <ol className="space-y-2 text-[13px]">
            {job.statusEvents.map((e, i) => <li key={i} className="flex justify-between gap-2"><span>{JOB_STATUS[e.toStatus]?.label}</span><span className="text-muted-foreground">{formatInstant(e.occurredAt, tz)}</span></li>)}
          </ol>
        </CardBody>
      </Card>
      <p className="text-center text-[12px] text-muted-foreground">{SERVICE_TYPE_LABEL[job.serviceType]}</p>
    </div>
  );
}
