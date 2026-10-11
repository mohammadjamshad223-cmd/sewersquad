import Link from "next/link";
import { Inbox } from "lucide-react";
import type { TicketStatus } from "@prisma/client";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/ui/filters";
import { formatInstant } from "@/lib/dates";
import { TICKET_STATUS } from "@/lib/status";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Inquiries" };

export default async function Support({ searchParams }: { searchParams: Promise<{ status?: string; category?: string; q?: string; mine?: string }> }) {
  const actor = await requireStaffPage("support.manage");
  const sp = await searchParams;
  const tickets = await prisma.supportTicket.findMany({
    where: {
      ...(sp.status ? { status: sp.status as TicketStatus } : { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER"] } }),
      ...(sp.category ? { category: sp.category as never } : {}),
      ...(sp.mine ? { assignedToId: actor.userId } : {}),
      ...(sp.q ? { OR: [{ ticketNumber: { contains: sp.q, mode: "insensitive" } }, { subject: { contains: sp.q, mode: "insensitive" } }, { organization: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
    },
    include: { organization: { select: { name: true } }, location: { select: { name: true } }, _count: { select: { messages: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  const assignees = await prisma.user.findMany({ where: { id: { in: tickets.map((t) => t.assignedToId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return (
    <div>
      <PageHeader title="Customer inquiries" description="General questions, billing, service issues, callbacks, reschedule and additional-service requests." />
      <Card>
        <FilterBar search={{ placeholder: "Ticket #, subject, customer" }} selects={[{ param: "status", label: "Status", options: Object.entries(TICKET_STATUS).map(([value, m]) => ({ value, label: m.label })) }, { param: "category", label: "Category", options: ["GENERAL", "BILLING", "SERVICE_ISSUE", "CALLBACK", "RESCHEDULE", "ADDITIONAL_SERVICE"].map((c) => ({ value: c, label: titleCase(c) })) }, { param: "mine", label: "Assigned", options: [{ value: "1", label: "Assigned to me" }] }]} />
        {tickets.length === 0 ? <EmptyState icon={Inbox} title="Inbox zero" description="No open inquiries." /> : (
          <Table>
            <THead><tr><TH>Inquiry</TH><TH>Customer</TH><TH>Category</TH><TH>Owner</TH><TH>Updated</TH><TH>Status</TH></tr></THead>
            <TBody>
              {tickets.map((t) => (
                <TR key={t.id}>
                  <TD><Link href={`/admin/support/${t.id}`} className="font-medium hover:text-brand">{t.subject}</Link><span className="block text-[12px] text-muted-foreground">{t.ticketNumber} · {t._count.messages} messages</span></TD>
                  <TD>{t.organization.name}<span className="block text-[12px] text-muted-foreground">{t.location?.name}</span></TD>
                  <TD>{titleCase(t.category)}</TD>
                  <TD>{assignees.find((a) => a.id === t.assignedToId)?.name ?? <span className="text-muted-foreground">Unassigned</span>}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{formatInstant(t.updatedAt)}</TD>
                  <TD><StatusBadge kind="ticket" status={t.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
