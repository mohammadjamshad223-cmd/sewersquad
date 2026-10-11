import { idParam } from "@/server/params";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Check, FileText, Image as ImageIcon } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerJob, isRescheduled } from "@/server/services/customer-portal";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DescriptionList, PageHeader } from "@/components/ui/misc";
import { CustomerJobBadge, StatusBadge } from "@/components/ui/status-badge";
import { DocLink } from "@/components/portal/doc-link";
import { formatDateKey, formatInstant, formatWindow } from "@/lib/dates";
import { formatCents, formatGallons } from "@/lib/money";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL, customerJobStatus } from "@/lib/status";
import { companyTimeZone } from "@/server/services/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Service details" };

const STEPS = ["Scheduled", "Confirmed", "Driver En Route", "In Progress", "Completed"];

export default async function ServiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const { locationIds, access } = await customerContext();
  let job;
  try {
    job = await customerJob(locationIds, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const tz = await companyTimeZone();
  const current = customerJobStatus({ status: job.status, confirmedByOffice: job.confirmedByOffice }).label;
  const stepIdx = STEPS.indexOf(current);
  const gallons = job.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? null;
  const manifestPdf = job.manifest?.documents.find((d) => d.type === "MANIFEST");
  const photos = job.documents;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${SERVICE_TYPE_LABEL[job.serviceType]} · ${formatDateKey(job.scheduledDate, "long")}`}
        description={`${job.location.name} · ${job.jobNumber}`}
        breadcrumbs={[{ label: job.status === "COMPLETED" || job.status === "SUBMITTED" ? "Service history" : "Upcoming services", href: job.status === "COMPLETED" || job.status === "SUBMITTED" ? "/customer/history" : "/customer/services" }, { label: job.jobNumber }]}
        actions={
          <>
            <CustomerJobBadge status={job.status} confirmedByOffice={job.confirmedByOffice} rescheduled={isRescheduled(job)} />
            {access.allowRescheduleRequests && ["SCHEDULED", "ASSIGNED", "ACCEPTED"].includes(job.status) && (
              <Button asChild variant="secondary" size="sm">
                <Link href={`/customer/support/new?category=RESCHEDULE&jobId=${job.id}`}>Request schedule change</Link>
              </Button>
            )}
          </>
        }
      />

      {job.status !== "CANCELLED" && stepIdx >= 0 && (
        <Card>
          <CardBody>
            <ol className="grid grid-cols-5 gap-2" aria-label="Service progress">
              {STEPS.map((s, i) => (
                <li key={s} className="flex flex-col items-center gap-2 text-center">
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-full border text-[12px] font-semibold", i <= stepIdx ? "border-brand bg-brand text-brand-foreground" : "bg-surface text-muted-foreground")}>
                    {i < stepIdx ? <Check className="h-4 w-4" /> : i + 1}
                  </span>
                  <span className={cn("text-[12px]", i === stepIdx ? "font-semibold" : "text-muted-foreground")}>{s}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Visit" />
            <CardBody>
              <DescriptionList
                items={[
                  { label: "Scheduled date", value: formatDateKey(job.scheduledDate, "long") },
                  { label: "Service window", value: formatWindow(job.windowStart, job.windowEnd) },
                  { label: "Location", value: `${job.location.name}, ${job.location.addressLine1}, ${job.location.city}` },
                  { label: "Service type", value: SERVICE_TYPE_LABEL[job.serviceType] },
                  ...(access.showDriverNames && job.driver ? [{ label: "Technician", value: job.driver.user.name }] : []),
                  ...(job.serviceRecord?.finishedAt ? [{ label: "Completed", value: formatInstant(job.serviceRecord.finishedAt, tz) }] : []),
                  ...(gallons !== null ? [{ label: "Total pumped", value: formatGallons(gallons) }] : []),
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Equipment" />
            <CardBody className="divide-y p-0">
              {(job.serviceRecord?.assetRecords.length ? job.serviceRecord.assetRecords.map((r) => ({ ...r.asset, pumped: r.gallonsPumped, performed: r.servicePerformed })) : job.assets.map((a) => ({ ...a.asset, pumped: null as number | null, performed: null as string | null }))).map((a) => (
                <div key={a.assetTag} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{a.type === "OTHER" && a.customTypeLabel ? a.customTypeLabel : ASSET_TYPE_LABEL[a.type]}</p>
                    <p className="text-[12px] text-muted-foreground">{a.assetTag} · {a.capacityGallons.toLocaleString()} gal capacity</p>
                  </div>
                  <div className="text-right">
                    {a.pumped !== null && <p className="font-medium tabular-nums">{formatGallons(a.pumped)} pumped</p>}
                    {a.performed && <p className="text-[12px] text-muted-foreground">{a.performed}</p>}
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
          {photos.length > 0 && (
            <Card>
              <CardHeader title="Service photos" />
              <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {photos.map((p) => (
                  <a key={p.id} href={`/api/documents/${p.id}`} target="_blank" rel="noopener" className="group block overflow-hidden rounded-md border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/documents/${p.id}`} alt={p.title} className="aspect-square w-full object-cover transition group-hover:opacity-90" loading="lazy" />
                    <span className="block px-2 py-1 text-[11px] text-muted-foreground">{p.photoPhase === "BEFORE" ? "Before" : p.photoPhase === "AFTER" ? "After" : "Photo"}</span>
                  </a>
                ))}
              </CardBody>
            </Card>
          )}
          {job.serviceRecord?.followUpRecommendations && (
            <Card>
              <CardHeader title="Technician recommendations" />
              <CardBody className="text-sm">{job.serviceRecord.followUpRecommendations}</CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Documents" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Manifest {job.manifest?.manifestNumber ?? ""}</span>
                {manifestPdf ? <DocLink id={manifestPdf.id} /> : <span className="text-[12px] text-muted-foreground">{job.manifest ? "Pending review" : "After service"}</span>}
              </div>
              {job.manifest?.documents.filter((d) => d.type === "MANIFEST_OFFICIAL").map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" /> Official manifest</span>
                  <DocLink id={d.id} />
                </div>
              ))}
              {job.invoices.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2">
                  <Link href={`/customer/invoices/${i.id}`} className="font-medium text-brand hover:underline">Invoice {i.invoiceNumber}</Link>
                  <span className="flex items-center gap-2 text-[13px]">{formatCents(i.totalCents)} <StatusBadge kind="invoice" status={i.status} /></span>
                </div>
              ))}
              {photos.length === 0 && !job.manifest && job.invoices.length === 0 && <p className="text-muted-foreground"><ImageIcon className="mr-1 inline h-4 w-4" />Documents appear after the visit is completed and reviewed.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            <CardBody>
              <ol className="space-y-3 text-[13px]">
                {job.statusEvents.map((e, i) => (
                  <li key={i} className="flex justify-between gap-3">
                    <span>{customerJobStatus({ status: e.toStatus, confirmedByOffice: true }).label}</span>
                    <span className="text-muted-foreground">{formatInstant(e.occurredAt, tz)}</span>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
