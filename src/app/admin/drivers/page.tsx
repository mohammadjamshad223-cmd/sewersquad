import Link from "next/link";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { InviteDriverDialog, IssueResolveForm, VehicleDialog } from "@/components/admin/fleet-forms";
import { addDays, dateFromKey, formatDateKey, formatInstant, todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Drivers & fleet" };

function expiry(d: Date | null, today: string) {
  if (!d) return <span className="text-muted-foreground">—</span>;
  const soon = d.getTime() <= dateFromKey(addDays(today, 30)).getTime();
  const past = d.getTime() < dateFromKey(today).getTime();
  return <span className={past ? "font-medium text-danger" : soon ? "text-warning" : ""}>{formatDateKey(d)}{past ? " (expired)" : soon ? " (soon)" : ""}</span>;
}

export default async function DriversFleet({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const actor = await requireStaffPage("fleet.read");
  const tab = (await searchParams).tab ?? "drivers";
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000);
  const [drivers, vehicles, inspections, issues] = await Promise.all([
    tab === "drivers" ? prisma.driver.findMany({ include: { user: { select: { name: true, email: true, phone: true, status: true } }, defaultVehicle: { select: { unitNumber: true } }, _count: { select: { serviceRecords: { where: { submittedAt: { gte: monthAgo } } } } } }, orderBy: { user: { name: "asc" } } }) : [],
    tab === "fleet" ? prisma.vehicle.findMany({ orderBy: { unitNumber: "asc" }, include: { defaultFor: { select: { user: { select: { name: true } } } } } }) : [],
    tab === "inspections" ? prisma.vehicleInspection.findMany({ orderBy: { inspectedAt: "desc" }, take: 100, include: { vehicle: { select: { unitNumber: true, id: true } }, driver: { select: { user: { select: { name: true } } } } } }) : [],
    tab === "issues" ? prisma.issueReport.findMany({ orderBy: [{ status: "asc" }, { createdAt: "desc" }], take: 100, include: { job: { select: { id: true, jobNumber: true } } } }) : [],
  ]);
  const reporters = tab === "issues" ? await prisma.user.findMany({ where: { id: { in: issues.map((i) => i.reportedById) } }, select: { id: true, name: true } }) : [];
  const canWrite = hasPermission(actor, "fleet.write");
  return (
    <div>
      <PageHeader title="Drivers & fleet" actions={tab === "drivers" ? hasPermission(actor, "staff.manage") && <InviteDriverDialog /> : tab === "fleet" ? canWrite && <VehicleDialog /> : null} />
      <Tabs basePath="/admin/drivers" active={tab} tabs={[{ key: "drivers", label: "Drivers" }, { key: "fleet", label: "Trucks" }, { key: "inspections", label: "Inspections" }, { key: "issues", label: "Reported issues" }]} />
      {tab === "drivers" && (
        <Card>
          <Table>
            <THead><tr><TH>Driver</TH><TH>Employee #</TH><TH>Truck</TH><TH className="hidden md:table-cell">Territory</TH><TH>License expiry</TH><TH className="text-right">Jobs (30d)</TH><TH>Status</TH></tr></THead>
            <TBody>
              {drivers.map((d) => (
                <TR key={d.id}>
                  <TD><Link href={`/admin/drivers/${d.id}`} className="font-medium hover:text-brand">{d.user.name}</Link><span className="block text-[12px] text-muted-foreground">{d.user.phone ?? d.user.email}</span></TD>
                  <TD className="font-mono text-[12.5px]">{d.employeeNumber}</TD>
                  <TD>{d.defaultVehicle?.unitNumber ?? "—"}</TD>
                  <TD className="hidden md:table-cell">{d.territory ?? "—"}</TD>
                  <TD>{expiry(d.licenseExpiry, today)}</TD>
                  <TD className="text-right tabular-nums">{d._count.serviceRecords}</TD>
                  <TD><Badge tone={d.status === "ACTIVE" && d.user.status === "ACTIVE" ? "success" : d.user.status === "INVITED" ? "info" : "neutral"}>{d.user.status === "INVITED" ? "Invited" : titleCase(d.status)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "fleet" && (
        <Card>
          <Table>
            <THead><tr><TH>Truck</TH><TH className="text-right">Tank</TH><TH>Assigned to</TH><TH>Registration</TH><TH>Insurance</TH><TH className="hidden lg:table-cell">Permit</TH><TH>Status</TH></tr></THead>
            <TBody>
              {vehicles.map((v) => (
                <TR key={v.id}>
                  <TD><Link href={`/admin/fleet/${v.id}`} className="font-medium hover:text-brand">{v.unitNumber}</Link><span className="block text-[12px] text-muted-foreground">{[v.year, v.make, v.model].filter(Boolean).join(" ")}</span></TD>
                  <TD className="text-right tabular-nums">{v.tankCapacityGallons.toLocaleString()} gal</TD>
                  <TD>{v.defaultFor.map((d) => d.user.name).join(", ") || "—"}</TD>
                  <TD>{expiry(v.registrationExpiry, today)}</TD>
                  <TD>{expiry(v.insuranceExpiry, today)}</TD>
                  <TD className="hidden lg:table-cell">{v.permitNumber ?? "—"}</TD>
                  <TD><StatusBadge kind="vehicle" status={v.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "inspections" && (
        <Card>
          <Table>
            <THead><tr><TH>When</TH><TH>Truck</TH><TH>Driver</TH><TH>Type</TH><TH>Result</TH><TH className="hidden md:table-cell">Defects</TH></tr></THead>
            <TBody>
              {inspections.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap text-[13px]">{formatInstant(i.inspectedAt, tz)}</TD>
                  <TD><Link href={`/admin/fleet/${i.vehicle.id}`} className="hover:text-brand">{i.vehicle.unitNumber}</Link></TD>
                  <TD>{i.driver.user.name}</TD>
                  <TD>{i.type === "PRE_TRIP" ? "Pre-trip" : "Post-trip"}</TD>
                  <TD><Badge tone={i.hasDefects ? "danger" : "success"}>{i.hasDefects ? "Defects" : "OK"}</Badge></TD>
                  <TD className="hidden max-w-md truncate md:table-cell text-[13px]">{i.defectsSummary ?? "—"}</TD>
                </TR>
              ))}
              {inspections.length === 0 && <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">No inspections recorded.</TD></TR>}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "issues" && (
        <Card>
          <Table>
            <THead><tr><TH>Report</TH><TH>Category</TH><TH>Severity</TH><TH>Description</TH><TH>Reported</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
            <TBody>
              {issues.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap font-medium">{i.reportNumber}{i.job && <Link href={`/admin/jobs/${i.job.id}`} className="block text-[12px] font-normal text-brand">{i.job.jobNumber}</Link>}</TD>
                  <TD>{titleCase(i.category)}</TD>
                  <TD><Badge tone={i.severity === "CRITICAL" || i.severity === "HIGH" ? "danger" : i.severity === "MEDIUM" ? "warning" : "neutral"}>{titleCase(i.severity)}</Badge></TD>
                  <TD className="max-w-sm text-[13px]">{i.description}{i.resolution && <span className="block text-muted-foreground">→ {i.resolution}</span>}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{reporters.find((r) => r.id === i.reportedById)?.name}<span className="block text-muted-foreground">{formatInstant(i.createdAt, tz)}</span></TD>
                  <TD><StatusBadge kind="issue" status={i.status} /></TD>
                  <TD className="text-right">{i.status !== "RESOLVED" && (canWrite || hasPermission(actor, "jobs.dispatch")) && <IssueResolveForm issueId={i.id} status={i.status} />}</TD>
                </TR>
              ))}
              {issues.length === 0 && <TR><TD colSpan={7} className="py-8 text-center text-muted-foreground">No issues reported.</TD></TR>}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
