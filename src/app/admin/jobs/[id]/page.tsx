import Link from "next/link";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { jobDetail } from "@/server/services/jobs";
import { prisma } from "@/server/db";
import { buildManifestData, missingRequiredFields, templateFields } from "@/server/services/manifests";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { JobFilesForm } from "@/components/admin/job-files-form";
import { ReasonDialog, FieldInput } from "@/components/admin/dialogs";
import { CompleteJobButton } from "@/app/admin/dispatch/today";
import { DocLink } from "@/components/portal/doc-link";
import { approveJobAction, cancelJobAction, markMissedAction, rejectJobAction, rescheduleJobAction, reviewChargeAction } from "@/app/admin/_actions/ops";
import { formatDateKey, formatInstant, formatWindow, keyFromDate } from "@/lib/dates";
import { formatCents, formatGallons, formatRateCents } from "@/lib/money";
import { ASSET_TYPE_LABEL, JOB_STATUS, SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatAddress, titleCase } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";
import { JobNotesForm } from "./notes-form";

export const metadata = { title: "Job" };

export default async function AdminJobDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("jobs.read");
  const job = await jobDetail(id);
  if (!job) notFound();
  const tz = await companyTimeZone();
  const rec = job.serviceRecord;
  const gallons = rec?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0;
  const reviewable = job.status === "SUBMITTED" && hasPermission(actor, "jobs.approve");
  let missing: string[] = [];
  if (reviewable && job.manifest) {
    const tpl = job.manifest ? await prisma.manifestTemplate.findUnique({ where: { id: job.manifest.templateId ?? "00000000-0000-0000-0000-000000000000" } }) : null;
    missing = missingRequiredFields(templateFields(tpl), await buildManifestData(prisma, job.id)).map((f) => f.label);
  }
  const photos = job.documents.filter((d) => d.type === "SERVICE_PHOTO");
  const signatures = job.documents.filter((d) => d.type === "SIGNATURE");
  const notStarted = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "MISSED", "UNABLE_TO_SERVICE"].includes(job.status);
  const canWrite = hasPermission(actor, "jobs.write");

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{job.jobNumber}<StatusBadge kind="job" status={job.status} />{job.priority === "EMERGENCY" && <Badge tone="danger">Emergency</Badge>}{job.isDemo && <Badge>Demo</Badge>}</span>}
        description={`${job.location.name} · ${job.organization.name} · ${formatDateKey(job.scheduledDate, "long")}`}
        breadcrumbs={[{ label: "Jobs", href: "/admin/jobs" }, { label: job.jobNumber }]}
        actions={
          <>
            {canWrite && <Button asChild variant="secondary" size="sm"><Link href={`/admin/service-reports/new?job=${job.id}`}>Write service report</Link></Button>}
            {canWrite && notStarted && (
              <ReasonDialog trigger={{ label: "Reschedule" }} title="Reschedule job" description={job.planId ? "The plan's contractual occurrence date is preserved; only this visit moves." : undefined} action={rescheduleJobAction} hidden={{ jobId: job.id }} submitLabel="Reschedule">
                <FieldInput label="New date" name="date" type="date" required defaultValue={keyFromDate(job.scheduledDate)} />
                <div className="grid grid-cols-2 gap-3"><FieldInput label="Window start" name="windowStart" type="time" defaultValue={job.windowStart ?? ""} /><FieldInput label="Window end" name="windowEnd" type="time" defaultValue={job.windowEnd ?? ""} /></div>
              </ReasonDialog>
            )}
            {canWrite && ["SCHEDULED", "ASSIGNED", "ACCEPTED"].includes(job.status) && <ReasonDialog trigger={{ label: "Mark missed" }} title="Mark as missed" action={markMissedAction} hidden={{ jobId: job.id }} reasonName="note" reasonLabel="What happened?" submitLabel="Mark missed" />}
            {canWrite && !["COMPLETED", "CANCELLED", "SUBMITTED"].includes(job.status) && <ReasonDialog trigger={{ label: "Cancel", variant: "danger-outline" }} title="Cancel job" description={job.planId ? "This skips this occurrence of the recurring plan and schedules the next one. To keep the occurrence, reschedule instead." : undefined} action={cancelJobAction} hidden={{ jobId: job.id }} submitLabel="Cancel job" submitVariant="danger" />}
          </>
        }
      />
      {sp.created && <Alert tone="success" title="Job created">The customer has been notified.</Alert>}
      {job.emergencyRequest && <Alert tone="danger" title={`Emergency request ${job.emergencyRequest.requestNumber}`}><Link href={`/admin/emergencies/${job.emergencyRequest.id}`} className="underline">Open request</Link></Alert>}

      {reviewable && (
        <Card className="border-warning/40">
          <CardHeader title="Review submitted documentation" description="Approving finalizes the manifest, shares it and the approved photos with the customer, and generates the invoice per billing settings." />
          <CardBody className="space-y-3">
            {job.location.manifestFee === "CITY_OF_HOUSTON" && !job.documents.some((d) => d.type === "MANIFEST_OFFICIAL") && <Alert tone="warning" title="No City of Houston manifest attached">This location is in City of Houston jurisdiction. Ask the driver to photograph the City manifest, or upload it on the manifest page.</Alert>}
            {missing.length > 0 && <Alert tone="danger" title="Manifest is missing required fields">{missing.join(", ")}. Correct the manifest or send the job back to the driver.</Alert>}
            {job.charges.some((c) => c.status === "PENDING_APPROVAL") && <Alert tone="warning">Review the driver&apos;s additional charges below before approving.</Alert>}
            <div className="flex flex-wrap gap-2">
              <ReasonDialog trigger={{ label: "Approve & finalize", variant: "primary", size: "md" }} title="Approve documentation" action={approveJobAction} hidden={{ jobId: job.id }} reasonName="note" reasonLabel="Review note (optional)" reasonRequired={false} submitLabel="Approve & finalize" />
              <ReasonDialog trigger={{ label: "Request correction", size: "md" }} title="Send back to driver" action={rejectJobAction} hidden={{ jobId: job.id }} reasonLabel="What needs to be corrected?" submitLabel="Send to driver" submitVariant="danger" />
              {job.manifest && <Link href={`/admin/manifests/${job.manifest.id}`} className="inline-flex h-9 items-center text-[13px] font-medium text-brand hover:underline">Open manifest</Link>}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Visit" />
            <CardBody>
              <DescriptionList columns={3} items={[
                { label: "Customer", value: <Link href={`/admin/customers/${job.organizationId}`} className="text-brand hover:underline">{job.organization.name}</Link> },
                { label: "Location", value: <Link href={`/admin/locations/${job.locationId}`} className="text-brand hover:underline">{job.location.name}</Link> },
                { label: "Address", value: formatAddress(job.location) },
                { label: "Date", value: formatDateKey(job.scheduledDate, "long") },
                { label: "Window", value: formatWindow(job.windowStart, job.windowEnd) },
                { label: "Service", value: SERVICE_TYPE_LABEL[job.serviceType] },
                { label: "Type", value: titleCase(job.type) },
                { label: "Plan", value: job.plan ? `${job.plan.planNumber}${job.occurrenceDate ? ` · occurrence ${formatDateKey(job.occurrenceDate)}` : ""}` : "—" },
                { label: "Estimated gallons", value: job.estimatedGallons ? formatGallons(job.estimatedGallons) : "—" },
                { label: "Quoted price", value: job.quotedPriceCents !== null ? formatCents(job.quotedPriceCents) : "—" },
              ]} />
            </CardBody>
          </Card>

          {rec && (
            <Card>
              <CardHeader title="Service record" description={`Driver-entered · ${rec.submittedAt ? `submitted ${formatInstant(rec.submittedAt, tz)}` : "in progress"}`} />
              <Table>
                <THead><tr><TH>Equipment</TH><TH className="text-right">Capacity</TH><TH className="text-right">Pumped</TH><TH>Waste</TH><TH>Service</TH></tr></THead>
                <TBody>
                  {rec.assetRecords.map((a) => (
                    <TR key={a.id}>
                      <TD>{ASSET_TYPE_LABEL[a.asset.type]}<span className="block font-mono text-[12px] text-muted-foreground">{a.asset.assetTag}</span></TD>
                      <TD className="text-right tabular-nums">{a.capacityGallons.toLocaleString()}</TD>
                      <TD className="text-right font-medium tabular-nums">{a.gallonsPumped.toLocaleString()}</TD>
                      <TD>{a.wasteType}</TD><TD>{a.servicePerformed ?? "—"}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              <CardBody>
                <DescriptionList columns={3} items={[
                  { label: "Total pumped", value: formatGallons(gallons) },
                  { label: "Arrived", value: formatInstant(rec.arrivedAt, tz) },
                  { label: "Finished", value: formatInstant(rec.finishedAt, tz) },
                  { label: "Condition before", value: rec.conditionBefore },
                  { label: "Condition after", value: rec.conditionAfter },
                  { label: "Access issues", value: rec.accessIssues },
                  { label: "Unusual conditions", value: rec.unusualConditions },
                  { label: "Issues found", value: rec.issuesFound },
                  { label: "Recommended follow-up", value: rec.followUpRecommendations },
                  { label: "Additional work", value: rec.additionalWork },
                  { label: "Driver notes", value: rec.notes },
                  { label: "Review", value: rec.reviewNotes ? `${titleCase(rec.reviewStatus)}: ${rec.reviewNotes}` : titleCase(rec.reviewStatus) },
                ]} />
              </CardBody>
            </Card>
          )}

          {(photos.length > 0 || signatures.length > 0) && (
            <Card>
              <CardHeader title="Photos & signatures" description="Service photos become visible to the customer when the job is approved." />
              <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[...photos, ...signatures].map((p) => (
                  <a key={p.id} href={`/api/documents/${p.id}`} target="_blank" rel="noopener" className="block overflow-hidden rounded-md border bg-white">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/documents/${p.id}`} alt={p.title} className="aspect-square w-full object-contain" loading="lazy" />
                    <span className="block truncate border-t px-2 py-1 text-[11px] text-muted-foreground">{p.type === "SIGNATURE" ? p.title.split(" —")[0] : p.photoPhase === "BEFORE" ? "Before" : p.photoPhase === "AFTER" ? "After" : "Issue"} · {p.visibility === "CUSTOMER" ? "shared" : "internal"}</span>
                  </a>
                ))}
              </CardBody>
            </Card>
          )}

          {hasPermission(actor, "documents.write") && !["CANCELLED"].includes(job.status) && (
            <Card>
              <CardHeader title="Add photos & files" description="Upload photos from your phone or camera roll, a signed paper manifest, or any other document for this job." />
              <CardBody><JobFilesForm jobId={job.id} completed={job.status === "COMPLETED"} /></CardBody>
            </Card>
          )}

          {job.charges.length > 0 && (
            <Card>
              <CardHeader title="Additional charges" description="Added in the field; only approved charges are invoiced." />
              <Table>
                <THead><tr><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
                <TBody>
                  {job.charges.map((c) => (
                    <TR key={c.id}>
                      <TD>{c.description}<span className="block text-[12px] text-muted-foreground">{titleCase(c.kind)}</span></TD>
                      <TD className="text-right tabular-nums">{c.quantity.toString()}</TD>
                      <TD className="text-right tabular-nums">{formatRateCents(c.unitPriceCents.toString())}</TD>
                      <TD><Badge tone={c.status === "APPROVED" ? "success" : c.status === "REJECTED" ? "neutral" : "warning"}>{titleCase(c.status)}</Badge></TD>
                      <TD className="whitespace-nowrap text-right">{c.status === "PENDING_APPROVAL" && <><ActionButton size="sm" variant="ghost" action={reviewChargeAction.bind(null, c.id, true)} successMessage="Charge approved.">Approve</ActionButton><ActionButton size="sm" variant="ghost" className="text-danger" action={reviewChargeAction.bind(null, c.id, false)} successMessage="Charge rejected.">Reject</ActionButton></>}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {hasPermission(actor, "jobs.approve") && !["CANCELLED"].includes(job.status) && (
            <Card>
              <CardHeader title={job.status !== "COMPLETED" ? "Finish this job" : job.invoices.some((i) => i.status !== "VOID") ? "Customer paperwork" : "Invoice not confirmed yet"} description={job.status !== "COMPLETED" ? "Record gallons, photos and signatures and finalize the manifest. Then you confirm the invoice; the customer gets everything once you do." : job.invoices.some((i) => i.status !== "VOID") ? "Send the photos, manifest and invoice to the customer again." : "Check the price and lines, then confirm. The invoice and paperwork go to the customer when you do."} />
              <CardBody>
                <CompleteJobButton completed={job.status === "COMPLETED"} invoiced={job.invoices.some((i) => i.status !== "VOID")} job={{ id: job.id, status: job.status, location: job.location.name, cityManifest: job.location.manifestFee === "CITY_OF_HOUSTON", assets: job.assets.map((a) => ({ id: a.asset.id, label: a.asset.name || ASSET_TYPE_LABEL[a.asset.type] || "Equipment", capacity: a.asset.capacityGallons })) }} />
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Documents & billing" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span>Manifest</span>
                {job.manifest ? <Link href={`/admin/manifests/${job.manifest.id}`} className="flex items-center gap-2 font-medium text-brand hover:underline">{job.manifest.manifestNumber} <StatusBadge kind="manifest" status={job.manifest.status} /></Link> : <span className="text-muted-foreground">Created on submission</span>}
              </div>
              {job.documents.filter((d) => ["MANIFEST", "MANIFEST_OFFICIAL", "OTHER", "DISPOSAL_TICKET"].includes(d.type)).map((d) => <div key={d.id} className="flex items-center justify-between gap-3"><span className="min-w-0 truncate text-muted-foreground">{d.title}{d.visibility === "INTERNAL" && <span className="ml-1.5 text-[11px] uppercase tracking-wide">· internal</span>}</span><DocLink id={d.id} /></div>)}
              <div className="flex items-center justify-between">
                <span>Invoice</span>
                {job.invoices[0] ? <Link href={`/admin/invoices/${job.invoices[0].id}`} className="flex items-center gap-2 font-medium text-brand hover:underline">{job.invoices[0].invoiceNumber} <StatusBadge kind="invoice" status={job.invoices[0].status} /></Link>
                  : job.status === "COMPLETED" && hasPermission(actor, "invoices.write") ? <Button asChild size="sm"><Link href={`/admin/jobs/${job.id}/invoice`}>Confirm invoice</Link></Button>
                  : <span className="text-muted-foreground">After the job is completed</span>}
              </div>
            </CardBody>
          </Card>
          {canWrite && (
            <Card>
              <CardHeader title="Notes & instructions" />
              <CardBody><JobNotesForm job={{ id: job.id, instructions: job.instructions, internalNotes: job.internalNotes, estimatedGallons: job.estimatedGallons, priority: job.priority, confirmedByOffice: job.confirmedByOffice }} /></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="space-y-2.5 text-[13px]">
                {job.statusEvents.map((e) => (
                  <li key={e.id}>
                    <div className="flex justify-between gap-2"><span className="font-medium">{JOB_STATUS[e.toStatus]?.label}</span><span className="text-muted-foreground">{formatInstant(e.occurredAt, tz)}</span></div>
                    {e.note && <p className="text-muted-foreground">{e.note}</p>}
                    {e.latitude && <p className="text-[12px] text-muted-foreground">GPS {e.latitude.toFixed(4)}, {e.longitude?.toFixed(4)}</p>}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          {job.issues.length > 0 && (
            <Card>
              <CardHeader title="Reported issues" />
              <CardBody className="space-y-2 text-[13px]">{job.issues.map((i) => <p key={i.id}><StatusBadge kind="issue" status={i.status} /> {i.description}</p>)}</CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
