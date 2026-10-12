import Link from "next/link";
import { NotebookPen, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/ui/filters";
import { formatDateKey } from "@/lib/dates";
import { REPORT_TONE } from "@/lib/status";

export const metadata = { title: "Service Reports" };

export default async function ServiceReports({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("jobs.read");
  const sp = await searchParams;
  const where: Prisma.ServiceReportWhereInput = {
    ...(sp.status === "DRAFT" || sp.status === "FINAL" ? { status: sp.status } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { preparedFor: { contains: sp.q, mode: "insensitive" } }, { subject: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const items = await prisma.serviceReport.findMany({ where, orderBy: [{ serviceDate: "desc" }, { number: "desc" }], take: 200 });
  return (
    <div className="space-y-6">
      <PageHeader title="Service Reports" description="Findings and recommendations for a visit, printed in your Sewer Squad layout and shared in the customer's portal." actions={hasPermission(actor, "jobs.write") && <Button asChild><Link href="/admin/service-reports/new"><Plus /> New report</Link></Button>} />
      <Card>
        <FilterBar search={{ placeholder: "Number, business or subject" }} selects={[{ param: "status", label: "Status", options: [{ value: "DRAFT", label: "Draft" }, { value: "FINAL", label: "Final" }] }]} />
        {items.length === 0 ? <EmptyState icon={NotebookPen} title="No service reports yet" description="Write one from a job page or start a new report." /> : (
          <Table>
            <THead><tr><TH>Report</TH><TH>Prepared for</TH><TH>Service date</TH><TH>Subject</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((r) => (
                <TR key={r.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/service-reports/${r.id}`} className="font-medium hover:text-brand">{r.number}</Link></TD>
                  <TD>{r.preparedFor}<span className="block text-[12px] text-muted-foreground">{r.addressLine1}, {r.city}</span></TD>
                  <TD className="whitespace-nowrap">{formatDateKey(r.serviceDate)}</TD>
                  <TD className="text-[13px]">{r.subject}</TD>
                  <TD><Badge tone={REPORT_TONE[r.status]}>{r.status === "FINAL" ? "shared" : "draft"}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
