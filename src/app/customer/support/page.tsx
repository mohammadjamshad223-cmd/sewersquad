import Link from "next/link";
import { LifeBuoy, Plus } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInstant } from "@/lib/dates";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Support" };

export default async function Support() {
  const { actor, scope } = await customerContext();
  const tickets = await prisma.supportTicket.findMany({
    where: { organizationId: { in: scope.orgIds }, OR: [{ locationId: { in: scope.locationIds } }, { createdById: actor.userId }, { locationId: null, organizationId: { in: scope.orgAdminOrgIds } }] },
    include: { location: { select: { name: true } }, _count: { select: { messages: { where: { isInternal: false } } } } },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return (
    <div>
      <PageHeader title="Support" description="Questions about billing, service or your account. We usually reply within one business day." actions={<Button asChild><Link href="/customer/support/new"><Plus /> New inquiry</Link></Button>} />
      <Card>
        {tickets.length === 0 ? (
          <EmptyState icon={LifeBuoy} title="No inquiries yet" action={<Button asChild variant="secondary"><Link href="/customer/support/new">Contact support</Link></Button>} />
        ) : (
          <Table>
            <THead><tr><TH>Inquiry</TH><TH>Category</TH><TH className="hidden md:table-cell">Location</TH><TH>Updated</TH><TH>Status</TH></tr></THead>
            <TBody>
              {tickets.map((t) => (
                <TR key={t.id}>
                  <TD><Link href={`/customer/support/${t.id}`} className="font-medium hover:text-brand">{t.subject}</Link><span className="block text-[12px] text-muted-foreground">{t.ticketNumber} · {t._count.messages} messages</span></TD>
                  <TD>{titleCase(t.category)}</TD>
                  <TD className="hidden md:table-cell">{t.location?.name ?? "—"}</TD>
                  <TD className="whitespace-nowrap">{formatInstant(t.updatedAt)}</TD>
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
