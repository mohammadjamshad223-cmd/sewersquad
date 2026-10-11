import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocLink } from "@/components/portal/doc-link";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { cn, titleCase } from "@/lib/utils";
import { StaffReplyForm, TicketMetaForm } from "./forms";

export const metadata = { title: "Inquiry" };

export default async function TicketDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  await requireStaffPage("support.manage");
  const t = await prisma.supportTicket.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, messages: { orderBy: { createdAt: "asc" } }, documents: { where: { deletedAt: null } }, job: { select: { id: true, jobNumber: true, scheduledDate: true } }, invoice: { select: { id: true, invoiceNumber: true } } } });
  if (!t) notFound();
  const [people, staff, jobs, invoices] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: [t.createdById, ...t.messages.map((m) => m.authorId)] } }, select: { id: true, name: true, kind: true, email: true, phone: true } }),
    prisma.user.findMany({ where: { kind: "STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.job.findMany({ where: { organizationId: t.organizationId }, orderBy: { scheduledDate: "desc" }, take: 30, select: { id: true, jobNumber: true, scheduledDate: true } }),
    prisma.invoice.findMany({ where: { organizationId: t.organizationId }, orderBy: { issueDate: "desc" }, take: 30, select: { id: true, invoiceNumber: true } }),
  ]);
  const requester = people.find((p) => p.id === t.createdById);
  return (
    <div className="space-y-6">
      <PageHeader title={t.subject} description={`${t.ticketNumber} · ${titleCase(t.category)} · ${t.organization.name}`} breadcrumbs={[{ label: "Inquiries", href: "/admin/support" }, { label: t.ticketNumber }]} actions={<StatusBadge kind="ticket" status={t.status} />} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-3">
              {t.messages.map((m) => {
                const a = people.find((p) => p.id === m.authorId);
                const staffMsg = a?.kind !== "CUSTOMER";
                return (
                  <div key={m.id} className={cn("max-w-2xl rounded-lg border px-4 py-3", m.isInternal ? "border-warning/40 bg-warning-soft/60" : staffMsg ? "ml-auto bg-brand-soft/50" : "bg-surface")}>
                    <p className="text-[12px] text-muted-foreground"><span className="font-medium text-foreground">{a?.name}</span>{m.isInternal && <Badge tone="warning" className="ml-2">Internal note</Badge>} · {formatInstant(m.createdAt)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
                  </div>
                );
              })}
              {t.documents.length > 0 && <div className="flex flex-wrap gap-4 border-t pt-3">{t.documents.map((d) => <DocLink key={d.id} id={d.id}>{d.title}</DocLink>)}</div>}
            </CardBody>
          </Card>
          <Card><CardHeader title="Respond" /><CardBody><StaffReplyForm ticketId={t.id} /></CardBody></Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <DescriptionList columns={1} items={[
                { label: "Requested by", value: requester ? `${requester.name} · ${requester.email}` : "—" },
                { label: "Customer", value: <Link href={`/admin/customers/${t.organization.id}`} className="text-brand hover:underline">{t.organization.name}</Link> },
                { label: "Location", value: t.location ? <Link href={`/admin/locations/${t.location.id}`} className="text-brand hover:underline">{t.location.name}</Link> : "—" },
                ...(t.callbackPhone ? [{ label: "Callback phone", value: <a href={`tel:${t.callbackPhone.replace(/[^\d+]/g, "")}`} className="text-brand">{t.callbackPhone}</a> }] : []),
                ...(t.requestedDate ? [{ label: "Requested date", value: formatDateKey(t.requestedDate, "long") }] : []),
                ...(t.job ? [{ label: "Job", value: <Link href={`/admin/jobs/${t.job.id}`} className="text-brand hover:underline">{t.job.jobNumber} ({formatDateKey(t.job.scheduledDate)})</Link> }] : []),
                ...(t.invoice ? [{ label: "Invoice", value: <Link href={`/admin/invoices/${t.invoice.id}`} className="text-brand hover:underline">{t.invoice.invoiceNumber}</Link> }] : []),
              ]} />
              {t.category === "RESCHEDULE" && t.job && <p className="mt-3 text-[13px]"><Link href={`/admin/jobs/${t.job.id}`} className="font-medium text-brand hover:underline">Open the job to reschedule →</Link></p>}
            </CardBody>
          </Card>
          <Card><CardHeader title="Manage" /><CardBody><TicketMetaForm ticket={t} staff={staff} jobs={jobs.map((j) => ({ id: j.id, label: `${j.jobNumber} · ${formatDateKey(j.scheduledDate)}` }))} invoices={invoices.map((i) => ({ id: i.id, label: i.invoiceNumber }))} /></CardBody></Card>
        </div>
      </div>
    </div>
  );
}
