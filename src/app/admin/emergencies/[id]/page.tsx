import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { canTransitionEmergency } from "@/domain/job-state";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActionButton } from "@/components/ui/form";
import { ReasonDialog, FieldInput } from "@/components/admin/dialogs";
import { acknowledgeEmergencyAction, emergencyStatusAction, emergencyTermsAction, dispatchEmergencyAction } from "@/app/admin/_actions/ops";
import { formatInstant, todayKey } from "@/lib/dates";
import { centsToDollarInput, formatCents } from "@/lib/money";
import { ASSET_TYPE_LABEL, EMERGENCY_CATEGORY_LABEL, EMERGENCY_STATUS, SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatAddress, telHref, titleCase } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";
import { DispatchFields } from "./dispatch-fields";

export const metadata = { title: "Emergency request" };

export default async function EmergencyDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const actor = await requireStaffPage("emergencies.manage");
  const er = await prisma.emergencyRequest.findUnique({ where: { id }, include: { location: { include: { assets: { where: { deletedAt: null, status: "ACTIVE" } } } }, organization: true, job: { select: { id: true, jobNumber: true, status: true } }, events: { orderBy: { occurredAt: "asc" } }, documents: { where: { deletedAt: null } } } });
  if (!er) notFound();
  const tz = await companyTimeZone();
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { status: "ACTIVE" }, select: { id: true, defaultVehicleId: true, user: { select: { name: true } } } }),
    prisma.vehicle.findMany({ where: { status: { notIn: ["MAINTENANCE", "OUT_OF_SERVICE"] } }, select: { id: true, unitNumber: true } }),
  ]);
  const closed = er.status === "COMPLETED" || er.status === "CANCELLED";
  const toLocal = (d: Date | null) => (d ? new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d).replace(" ", "T") : "");
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-2">{er.requestNumber}<StatusBadge kind="severity" status={er.severity} /><StatusBadge kind="emergency" status={er.status} /></span>}
        description={`${er.location.name} · ${er.organization.name} · received ${formatInstant(er.createdAt, tz)}`}
        breadcrumbs={[{ label: "Emergency requests", href: "/admin/emergencies" }, { label: er.requestNumber }]}
        actions={<Button asChild variant="danger"><a href={telHref(er.contactPhone)}><Phone /> Call {er.contactName}</a></Button>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Request" />
            <CardBody>
              <DescriptionList columns={3} items={[
                { label: "Issue", value: EMERGENCY_CATEGORY_LABEL[er.category] },
                { label: "Service", value: SERVICE_TYPE_LABEL[er.serviceType] },
                { label: "Requested timing", value: er.requestedTiming === "SPECIFIC_TIME" && er.requestedFor ? formatInstant(er.requestedFor, tz) : titleCase(er.requestedTiming) },
                { label: "Contact", value: `${er.contactName} · ${er.contactPhone}${er.contactEmail ? ` · ${er.contactEmail}` : ""}` },
                { label: "Preferred contact", value: titleCase(er.preferredContact) },
                { label: "Address", value: formatAddress(er.location) },
                { label: "Description", value: er.description },
                { label: "Access instructions", value: er.location.accessInstructions },
              ]} />
              {er.documents.length > 0 && (
                <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {er.documents.map((d) => (
                    <a key={d.id} href={`/api/documents/${d.id}`} target="_blank" rel="noopener" className="overflow-hidden rounded border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/documents/${d.id}`} alt={d.title} className="aspect-square w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Timeline" description="Entries marked customer-visible appear on the customer's tracking page." />
            <CardBody>
              <ol className="space-y-3 text-[13px]">
                {er.events.map((e) => (
                  <li key={e.id}><div className="flex justify-between gap-2"><span className="font-medium">{EMERGENCY_STATUS[e.toStatus]?.label}{!e.customerVisible && <span className="ml-2 text-muted-foreground">(internal)</span>}</span><span className="text-muted-foreground">{formatInstant(e.occurredAt, tz)}</span></div>{e.note && <p className="text-muted-foreground">{e.note}</p>}</li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          {!closed && (
            <Card>
              <CardHeader title="1 · Triage" />
              <CardBody className="flex flex-wrap gap-2">
                {er.status === "SUBMITTED" && <ActionButton action={acknowledgeEmergencyAction.bind(null, er.id)} successMessage="Acknowledged — customer notified.">Acknowledge</ActionButton>}
                {canTransitionEmergency(er.status, "CONTACTING_CUSTOMER") && <ReasonDialog trigger={{ label: "Contacting customer" }} title="Contacting customer" action={emergencyStatusAction} hidden={{ id: er.id, to: "CONTACTING_CUSTOMER" }} reasonName="note" reasonLabel="Note to customer (optional)" reasonRequired={false} submitLabel="Update" />}
                {canTransitionEmergency(er.status, "AWAITING_APPROVAL") && <ReasonDialog trigger={{ label: "Awaiting approval" }} title="Awaiting customer approval" action={emergencyStatusAction} hidden={{ id: er.id, to: "AWAITING_APPROVAL" }} reasonName="note" reasonLabel="Note to customer" reasonRequired={false} submitLabel="Update" />}
                {canTransitionEmergency(er.status, "CANCELLED") && <ReasonDialog trigger={{ label: "Cancel request", variant: "danger-outline" }} title="Cancel emergency request" action={emergencyStatusAction} hidden={{ id: er.id, to: "CANCELLED" }} reasonName="note" reasonLabel="Reason (shared with customer)" submitLabel="Cancel request" submitVariant="danger" />}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="2 · Confirmed terms" description="Record only what you confirmed with the customer." />
            <CardBody>
              <DescriptionList columns={1} items={[{ label: "Confirmed arrival", value: er.confirmedArrival ? formatInstant(er.confirmedArrival, tz) : "Not confirmed" }, { label: "Confirmed price", value: er.confirmedPriceCents !== null ? formatCents(er.confirmedPriceCents) : "Not confirmed" }, { label: "Customer approval", value: er.customerApprovedAt ? formatInstant(er.customerApprovedAt, tz) : "Not yet" }]} />
              {!closed && !er.jobId && (
                <div className="mt-4">
                  <ReasonDialog trigger={{ label: "Record confirmed terms", size: "md" }} title="Confirmed timing & pricing" action={emergencyTermsAction} hidden={{ id: er.id }} reasonName="note" reasonLabel="Internal note" reasonRequired={false} submitLabel="Save">
                    <FieldInput label="Confirmed arrival" name="confirmedArrival" type="datetime-local" defaultValue={toLocal(er.confirmedArrival)} />
                    <FieldInput label="Confirmed price ($)" name="confirmedPrice" inputMode="decimal" defaultValue={centsToDollarInput(er.confirmedPriceCents)} hint="Becomes the invoice's quoted price." />
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="customerApproved" defaultChecked={Boolean(er.customerApprovedAt)} className="h-4 w-4" /> Customer approved timing and price</label>
                  </ReasonDialog>
                </div>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="3 · Dispatch" />
            <CardBody>
              {er.job ? (
                <p className="text-sm">Dispatched as <Link href={`/admin/jobs/${er.job.id}`} className="font-medium text-brand hover:underline">{er.job.jobNumber}</Link> <StatusBadge kind="job" status={er.job.status} /></p>
              ) : closed ? <p className="text-sm text-muted-foreground">Closed.</p> : !er.customerApprovedAt ? (
                <Alert tone="info">Record the customer&apos;s approval of timing and price before dispatching.</Alert>
              ) : hasPermission(actor, "jobs.dispatch") ? (
                <ReasonDialog trigger={{ label: "Assign driver & truck", variant: "primary", size: "md" }} title="Dispatch emergency" action={dispatchEmergencyAction} hidden={{ id: er.id }} reasonName="instructions" reasonLabel="Instructions for driver" reasonRequired={false} submitLabel="Dispatch">
                  <DispatchFields drivers={drivers.map((d) => ({ id: d.id, name: d.user.name, vehicleId: d.defaultVehicleId }))} vehicles={vehicles} assets={er.location.assets.map((a) => ({ id: a.id, label: `${a.assetTag} · ${ASSET_TYPE_LABEL[a.type]} ${a.capacityGallons.toLocaleString()} gal` }))} today={todayKey(tz)} />
                </ReasonDialog>
              ) : <p className="text-sm text-muted-foreground">You need dispatch permission.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
