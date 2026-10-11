import { customerContext } from "@/server/customer-context";
import { prisma } from "@/server/db";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { formatDateKey } from "@/lib/dates";
import { TicketForm } from "./ticket-form";

export const metadata = { title: "New inquiry" };

export default async function NewTicket({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { actor, scope, selectedLocationId, locationIds } = await customerContext();
  const job = sp.jobId ? await prisma.job.findFirst({ where: { id: sp.jobId, locationId: { in: locationIds } }, select: { id: true, jobNumber: true, scheduledDate: true, locationId: true, location: { select: { name: true } } } }) : null;
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { phone: true } });
  const subject = job && sp.category === "RESCHEDULE" ? `Reschedule request — ${job.location.name}, ${formatDateKey(job.scheduledDate)} (${job.jobNumber})` : undefined;
  return (
    <div>
      <PageHeader title="Contact support" breadcrumbs={[{ label: "Support", href: "/customer/support" }, { label: "New inquiry" }]} />
      <Card>
        <CardBody>
          <TicketForm locations={scope.locations} defaults={{ category: sp.category, jobId: job?.id, invoiceId: sp.invoiceId, locationId: job?.locationId ?? selectedLocationId, subject, phone: user.phone ?? undefined }} />
        </CardBody>
      </Card>
    </div>
  );
}
