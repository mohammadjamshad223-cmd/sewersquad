import Link from "next/link";
import { Siren } from "lucide-react";
import type { EmergencyStatus } from "@prisma/client";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/ui/filters";
import { formatInstant } from "@/lib/dates";
import { EMERGENCY_CATEGORY_LABEL, EMERGENCY_STATUS } from "@/lib/status";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Emergency requests" };
const OPEN: EmergencyStatus[] = ["SUBMITTED", "ACKNOWLEDGED", "CONTACTING_CUSTOMER", "AWAITING_APPROVAL", "DISPATCHED", "EN_ROUTE", "IN_PROGRESS"];

export default async function Emergencies({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  await requireStaffPage("emergencies.manage");
  const sp = await searchParams;
  const tz = await companyTimeZone();
  const items = await prisma.emergencyRequest.findMany({
    where: {
      ...(sp.status === "ALL" ? {} : sp.status ? { status: sp.status as EmergencyStatus } : { status: { in: OPEN } }),
      ...(sp.q ? { OR: [{ requestNumber: { contains: sp.q, mode: "insensitive" } }, { location: { name: { contains: sp.q, mode: "insensitive" } } }, { contactPhone: { contains: sp.q } }] } : {}),
    },
    include: { location: { select: { name: true, city: true } }, organization: { select: { name: true } }, job: { select: { jobNumber: true } } },
    orderBy: [{ createdAt: "desc" }],
    take: 200,
  });
  const rank = { URGENT: 0, HIGH: 1, STANDARD: 2 } as const;
  items.sort((a, b) => (OPEN.includes(a.status) === OPEN.includes(b.status) ? rank[a.severity] - rank[b.severity] || b.createdAt.getTime() - a.createdAt.getTime() : OPEN.includes(a.status) ? -1 : 1));
  return (
    <div>
      <PageHeader title="Emergency requests" description="Triage, confirm timing and pricing with the customer, then dispatch. Nothing is promised to the customer until you confirm it here." />
      <Card>
        <FilterBar search={{ placeholder: "Request #, location, phone" }} selects={[{ param: "status", label: "Status", options: [{ value: "ALL", label: "All (incl. closed)" }, ...Object.entries(EMERGENCY_STATUS).map(([value, m]) => ({ value, label: m.label }))] }]} />
        {items.length === 0 ? <EmptyState icon={Siren} title="No open emergency requests" /> : (
          <Table>
            <THead><tr><TH>Request</TH><TH>Severity</TH><TH>Location</TH><TH className="hidden md:table-cell">Issue</TH><TH>Contact</TH><TH>Received</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((e) => (
                <TR key={e.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/emergencies/${e.id}`} className="font-medium hover:text-brand">{e.requestNumber}</Link>{e.job && <span className="block text-[12px] text-muted-foreground">{e.job.jobNumber}</span>}</TD>
                  <TD><StatusBadge kind="severity" status={e.severity} /></TD>
                  <TD>{e.location.name}<span className="block text-[12px] text-muted-foreground">{e.organization.name}</span></TD>
                  <TD className="hidden md:table-cell">{EMERGENCY_CATEGORY_LABEL[e.category]}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{e.contactName}<a href={`tel:${e.contactPhone.replace(/[^\d+]/g, "")}`} className="block text-brand">{e.contactPhone}</a></TD>
                  <TD className="whitespace-nowrap text-[13px]">{formatInstant(e.createdAt, tz)}</TD>
                  <TD><StatusBadge kind="emergency" status={e.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
