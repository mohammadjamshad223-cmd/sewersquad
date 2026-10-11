import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DriverEditDialog } from "@/components/admin/fleet-forms";
import { ActionButton } from "@/components/ui/form";
import { sendAccessLinkAction } from "@/app/admin/_actions/customers";
import { formatDateKey, keyFromDate } from "@/lib/dates";
import { formatCents, formatGallons } from "@/lib/money";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Driver" };

export default async function DriverDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const actor = await requireStaffPage("fleet.read");
  const d = await prisma.driver.findUnique({ where: { id }, include: { user: true, defaultVehicle: true } });
  if (!d) notFound();
  const [jobs, totals, issues, vehicles] = await Promise.all([
    prisma.job.findMany({ where: { driverId: id }, orderBy: { scheduledDate: "desc" }, take: 25, include: { location: { select: { name: true } }, serviceRecord: { include: { assetRecords: { select: { gallonsPumped: true } } } } } }),
    prisma.serviceAssetRecord.aggregate({ where: { serviceRecord: { driverId: id, job: { status: { in: ["SUBMITTED", "COMPLETED"] } } } }, _sum: { gallonsPumped: true }, _count: true }),
    prisma.issueReport.count({ where: { reportedById: d.userId } }),
    prisma.vehicle.findMany({ select: { id: true, unitNumber: true }, orderBy: { unitNumber: "asc" } }),
  ]);
  const completed = await prisma.job.count({ where: { driverId: id, status: { in: ["SUBMITTED", "COMPLETED"] } } });
  return (
    <div className="space-y-6">
      <PageHeader title={d.user.name} description={`${d.employeeNumber} · ${titleCase(d.status)}`} breadcrumbs={[{ label: "Drivers & fleet", href: "/admin/drivers" }, { label: d.user.name }]} actions={<div className="flex gap-2">{hasPermission(actor, "staff.manage") && d.user.status !== "DEACTIVATED" && <ActionButton variant="secondary" size="sm" action={sendAccessLinkAction.bind(null, d.userId)} refresh={false}>{d.user.status === "INVITED" ? "Resend invite" : "Send reset link"}</ActionButton>}{hasPermission(actor, "fleet.write") && <DriverEditDialog driver={{ id: d.id, status: d.status, licenseNumber: d.licenseNumber, licenseClass: d.licenseClass, licenseExpiry: d.licenseExpiry ? keyFromDate(d.licenseExpiry) : null, territory: d.territory, hireDate: d.hireDate ? keyFromDate(d.hireDate) : null, hourlyCostCents: d.hourlyCostCents, defaultVehicleId: d.defaultVehicleId, phone: d.user.phone }} vehicles={vehicles} />}</div>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Completed jobs" value={completed} />
        <Stat label="Gallons pumped" value={formatGallons(totals._sum.gallonsPumped ?? 0)} />
        <Stat label="Issues reported" value={issues} href="/admin/drivers?tab=issues" />
      </div>
      <Card>
        <CardBody>
          <DescriptionList columns={3} items={[{ label: "Email", value: d.user.email }, { label: "Phone", value: d.user.phone }, { label: "Account", value: titleCase(d.user.status) }, { label: "Assigned truck", value: d.defaultVehicle ? <Link href={`/admin/fleet/${d.defaultVehicle.id}`} className="text-brand hover:underline">{d.defaultVehicle.unitNumber}</Link> : null }, { label: "Territory", value: d.territory }, { label: "License", value: [d.licenseNumber, d.licenseClass].filter(Boolean).join(" · ") || null }, { label: "License expires", value: d.licenseExpiry ? formatDateKey(d.licenseExpiry) : null }, { label: "Hire date", value: d.hireDate ? formatDateKey(d.hireDate) : null }, { label: "Labor cost", value: d.hourlyCostCents ? `${formatCents(d.hourlyCostCents)}/hr` : "Not set" }]} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Job history" />
        <Table>
          <THead><tr><TH>Date</TH><TH>Job</TH><TH>Location</TH><TH className="text-right">Gallons</TH><TH>Status</TH></tr></THead>
          <TBody>
            {jobs.map((j) => (
              <TR key={j.id}>
                <TD className="whitespace-nowrap">{formatDateKey(j.scheduledDate)}</TD>
                <TD><Link href={`/admin/jobs/${j.id}`} className="font-medium hover:text-brand">{j.jobNumber}</Link></TD>
                <TD>{j.location.name}</TD>
                <TD className="text-right tabular-nums">{j.serviceRecord ? j.serviceRecord.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0).toLocaleString() : "—"}</TD>
                <TD><StatusBadge kind="job" status={j.status} /></TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
