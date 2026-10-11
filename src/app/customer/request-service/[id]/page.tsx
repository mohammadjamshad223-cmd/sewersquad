import { idParam } from "@/server/params";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Phone } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { prisma } from "@/server/db";
import { getSetting, companyTimeZone } from "@/server/services/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInstant } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { EMERGENCY_CATEGORY_LABEL, EMERGENCY_STATUS, SERVICE_TYPE_LABEL } from "@/lib/status";
import { telHref } from "@/lib/utils";

export const metadata = { title: "Emergency request" };

export default async function EmergencyStatus({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const { locationIds } = await customerContext();
  const er = await prisma.emergencyRequest.findFirst({
    where: { id, locationId: { in: locationIds } },
    // internalNotes are deliberately not selected
    select: { id: true, requestNumber: true, status: true, severity: true, category: true, serviceType: true, description: true, contactName: true, contactPhone: true, requestedTiming: true, requestedFor: true, confirmedArrival: true, confirmedPriceCents: true, customerApprovedAt: true, createdAt: true, jobId: true, location: { select: { name: true } }, events: { where: { customerVisible: true }, orderBy: { occurredAt: "asc" }, select: { toStatus: true, note: true, occurredAt: true } } },
  });
  if (!er) notFound();
  const [tz, emergency] = await Promise.all([companyTimeZone(), getSetting("emergency")]);
  return (
    <div className="space-y-6">
      <PageHeader title={`Emergency request ${er.requestNumber}`} description={`${er.location.name} · submitted ${formatInstant(er.createdAt, tz)}`} breadcrumbs={[{ label: "Request service", href: "/customer/request-service" }, { label: er.requestNumber }]} actions={<StatusBadge kind="emergency" status={er.status} />} />
      {sp.submitted && (
        <Alert tone="success" title="Request received">
          Your request number is {er.requestNumber}. Dispatch will review it and contact you to confirm timing and pricing. Online submission does not guarantee immediate dispatch.
        </Alert>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Request" />
          <CardBody>
            <DescriptionList
              items={[
                { label: "Issue", value: EMERGENCY_CATEGORY_LABEL[er.category] },
                { label: "Severity", value: <StatusBadge kind="severity" status={er.severity} /> },
                { label: "Service", value: SERVICE_TYPE_LABEL[er.serviceType] },
                { label: "Contact", value: `${er.contactName} · ${er.contactPhone}` },
                // Times and prices are shown only once dispatch has confirmed them.
                { label: "Confirmed arrival", value: er.confirmedArrival ? formatInstant(er.confirmedArrival, tz) : "Not yet confirmed" },
                { label: "Confirmed price", value: er.confirmedPriceCents !== null ? formatCents(er.confirmedPriceCents) : "Not yet confirmed" },
                { label: "Description", value: er.description },
              ]}
            />
            {er.jobId && <p className="mt-4 text-sm"><Link href={`/customer/services/${er.jobId}`} className="font-medium text-brand hover:underline">Track the dispatched service visit →</Link></p>}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Status updates" />
            <CardBody>
              <ol className="space-y-3 text-[13px]">
                {er.events.map((e, i) => (
                  <li key={i}>
                    <div className="flex justify-between gap-2"><span className="font-medium">{EMERGENCY_STATUS[e.toStatus]?.label}</span><span className="text-muted-foreground">{formatInstant(e.occurredAt, tz)}</span></div>
                    {e.note && <p className="mt-0.5 text-muted-foreground">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
          {emergency.phone && <Button asChild variant="danger" className="w-full"><a href={telHref(emergency.phone)}><Phone /> Call dispatch: {emergency.phone}</a></Button>}
        </div>
      </div>
    </div>
  );
}
