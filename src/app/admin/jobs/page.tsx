import Link from "next/link";
import { ClipboardList, Plus } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { listJobs } from "@/server/services/jobs";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { formatDateKey, formatWindow } from "@/lib/dates";
import { JOB_STATUS, SERVICE_TYPE_LABEL } from "@/lib/status";

export const metadata = { title: "Jobs" };

export default async function Jobs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("jobs.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const [{ items, total, pageSize }, drivers] = await Promise.all([
    listJobs({ q: sp.q, status: sp.status, from: sp.from, to: sp.to, driverId: sp.driver, type: sp.type, organizationId: sp.org, page }),
    prisma.driver.findMany({ select: { id: true, user: { select: { name: true } } } }),
  ]);
  return (
    <div>
      <PageHeader
        title="Jobs"
        description="All scheduled, in-progress and completed service visits."
        actions={<>{hasPermission(actor, "jobs.write") && <Button asChild><Link href="/admin/jobs/new"><Plus /> New job</Link></Button>}<Button asChild variant="secondary"><a href={`/api/export/service-history?${new URLSearchParams(Object.entries({ from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][])}`}>Export CSV</a></Button></>}
      />
      <Card>
        <FilterBar
          search={{ placeholder: "Job #, customer, location, address…" }}
          dates
          selects={[
            { param: "status", label: "Status", options: [{ value: "OPEN", label: "Open" }, { value: "UNASSIGNED", label: "Unassigned" }, { value: "OVERDUE", label: "Overdue" }, ...Object.entries(JOB_STATUS).map(([value, m]) => ({ value, label: m.label }))] },
            { param: "type", label: "Type", options: [{ value: "RECURRING", label: "Recurring" }, { value: "ONE_TIME", label: "One-time" }, { value: "EMERGENCY", label: "Emergency" }] },
            { param: "driver", label: "Driver", options: drivers.map((d) => ({ value: d.id, label: d.user.name })) },
          ]}
        />
        {items.length === 0 ? <EmptyState icon={ClipboardList} title="No jobs match these filters" /> : (
          <Table>
            <THead><tr><TH>Date</TH><TH>Job</TH><TH>Customer / location</TH><TH className="hidden lg:table-cell">Service</TH><TH className="hidden md:table-cell">Window</TH><TH>Driver · Truck</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((j) => (
                <TR key={j.id}>
                  <TD className="whitespace-nowrap">{formatDateKey(j.scheduledDate, "weekday")}</TD>
                  <TD className="whitespace-nowrap"><Link href={`/admin/jobs/${j.id}`} className="font-medium hover:text-brand">{j.jobNumber}</Link>{j.priority === "EMERGENCY" && <Badge tone="danger" className="ml-2">Emergency</Badge>}</TD>
                  <TD>{j.location.name}<span className="block text-[12px] text-muted-foreground">{j.organization.name}</span></TD>
                  <TD className="hidden lg:table-cell">{SERVICE_TYPE_LABEL[j.serviceType]}</TD>
                  <TD className="hidden md:table-cell whitespace-nowrap text-[13px]">{formatWindow(j.windowStart, j.windowEnd)}</TD>
                  <TD>{j.driver ? <>{j.driver.user.name}<span className="block text-[12px] text-muted-foreground">{j.vehicle?.unitNumber ?? "No truck"}</span></> : <span className="text-warning">Unassigned</span>}</TD>
                  <TD><StatusBadge kind="job" status={j.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/jobs" />
      </Card>
    </div>
  );
}
