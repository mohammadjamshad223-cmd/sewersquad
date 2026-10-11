import Link from "next/link";
import { AlertTriangle, CalendarPlus, Phone } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { getSetting } from "@/server/services/settings";
import { prisma } from "@/server/db";
import { canEditForOrg } from "@/server/authz/scope";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { telHref } from "@/lib/utils";
import { formatInstant } from "@/lib/dates";
import { EmergencyForm } from "./emergency-form";

export const metadata = { title: "Request service" };

export default async function RequestService() {
  const { actor, scope, selectedLocationId, locationIds } = await customerContext();
  const [emergency, user, recent] = await Promise.all([
    getSetting("emergency"),
    prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { name: true, phone: true, email: true } }),
    prisma.emergencyRequest.findMany({ where: { locationId: { in: locationIds } }, orderBy: { createdAt: "desc" }, take: 5, include: { location: { select: { name: true } } } }),
  ]);
  const editable = scope.locations.filter((l) => canEditForOrg(scope, l.organizationId));
  return (
    <div className="space-y-6">
      <PageHeader title="Request service" description="Request emergency pumping or schedule additional service." />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-danger/25">
          <CardHeader title={<span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-danger" /> Emergency service request</span>} />
          <CardBody className="space-y-5">
            <Alert tone="warning" title="Online submission does not guarantee immediate dispatch">{emergency.notice}</Alert>
            {emergency.phone && (
              <Button asChild variant="danger" size="lg" className="w-full sm:w-auto">
                <a href={telHref(emergency.phone)}><Phone /> Call dispatch now: {emergency.phone}</a>
              </Button>
            )}
            {editable.length ? (
              <EmergencyForm locations={editable} defaultLocationId={selectedLocationId} contact={{ name: user.name, phone: user.phone ?? "", email: user.email }} />
            ) : (
              <p className="text-sm text-muted-foreground">Your read-only access doesn&apos;t allow submitting requests. Please call us.</p>
            )}
          </CardBody>
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><CalendarPlus className="h-4 w-4" /> Additional or one-time service</span>} />
            <CardBody className="space-y-3 text-sm text-muted-foreground">
              <p>Need an extra pump-out, line jetting or an inspection? Send a request and we&apos;ll confirm a date and price.</p>
              <Button asChild variant="secondary" className="w-full"><Link href="/customer/support/new?category=ADDITIONAL_SERVICE">Request additional service</Link></Button>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent requests" />
            <CardBody className="space-y-3">
              {recent.length === 0 && <p className="text-sm text-muted-foreground">No emergency requests yet.</p>}
              {recent.map((r) => (
                <Link key={r.id} href={`/customer/request-service/${r.id}`} className="flex items-center justify-between gap-2 text-sm hover:text-brand">
                  <span><span className="font-medium">{r.requestNumber}</span><span className="block text-[12px] text-muted-foreground">{r.location.name} · {formatInstant(r.createdAt, undefined, "date")}</span></span>
                  <StatusBadge kind="emergency" status={r.status} />
                </Link>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
