import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { MaintenanceDialog, VehicleDialog } from "@/components/admin/fleet-forms";
import { formatDateKey, formatInstant, keyFromDate, todayKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Truck" };

export default async function VehicleDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const actor = await requireStaffPage("fleet.read");
  const v = await prisma.vehicle.findUnique({ where: { id }, include: { maintenance: { orderBy: { performedOn: "desc" } }, inspections: { orderBy: { inspectedAt: "desc" }, take: 20, include: { driver: { select: { user: { select: { name: true } } } } } }, defaultFor: { select: { user: { select: { name: true } } } } } });
  if (!v) notFound();
  const tz = await companyTimeZone();
  const k = (d: Date | null) => (d ? keyFromDate(d) : null);
  return (
    <div className="space-y-6">
      <PageHeader title={`Truck ${v.unitNumber}`} description={[v.year, v.make, v.model].filter(Boolean).join(" ")} breadcrumbs={[{ label: "Drivers & fleet", href: "/admin/drivers?tab=fleet" }, { label: v.unitNumber }]} actions={<><StatusBadge kind="vehicle" status={v.status} />{hasPermission(actor, "fleet.write") && <><VehicleDialog vehicle={{ ...v, registrationExpiry: k(v.registrationExpiry), insuranceExpiry: k(v.insuranceExpiry), permitExpiry: k(v.permitExpiry) }} /><MaintenanceDialog vehicleId={v.id} today={todayKey(tz)} /></>}</>} />
      <Card><CardBody><DescriptionList columns={3} items={[{ label: "Tank capacity", value: `${v.tankCapacityGallons.toLocaleString()} gal` }, { label: "VIN", value: v.vin }, { label: "Plate", value: v.licensePlate }, { label: "Registration expires", value: v.registrationExpiry ? formatDateKey(v.registrationExpiry) : null }, { label: "Insurance expires", value: v.insuranceExpiry ? formatDateKey(v.insuranceExpiry) : null }, { label: "Permit", value: [v.permitNumber, v.permitExpiry ? `exp. ${formatDateKey(v.permitExpiry)}` : null].filter(Boolean).join(" · ") || null }, { label: "Assigned drivers", value: v.defaultFor.map((d) => d.user.name).join(", ") || null }, { label: "Operating cost", value: v.costPerHourCents ? `${formatCents(v.costPerHourCents)}/hr` : "Not set" }, { label: "Notes", value: v.notes }]} /></CardBody></Card>
      <Card>
        <CardHeader title="Maintenance history" />
        <Table>
          <THead><tr><TH>Date</TH><TH>Category</TH><TH>Description</TH><TH>Vendor</TH><TH className="text-right">Odometer</TH><TH className="text-right">Cost</TH></tr></THead>
          <TBody>
            {v.maintenance.map((m) => <TR key={m.id}><TD className="whitespace-nowrap">{formatDateKey(m.performedOn)}</TD><TD>{m.category}</TD><TD>{m.description}</TD><TD>{m.vendor ?? "—"}</TD><TD className="text-right tabular-nums">{m.odometer?.toLocaleString() ?? "—"}</TD><TD className="text-right tabular-nums">{formatCents(m.costCents)}</TD></TR>)}
            {v.maintenance.length === 0 && <TR><TD colSpan={6} className="py-6 text-center text-muted-foreground">No maintenance logged.</TD></TR>}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Inspections" />
        <Table>
          <THead><tr><TH>When</TH><TH>Driver</TH><TH>Type</TH><TH>Result</TH><TH>Defects</TH></tr></THead>
          <TBody>
            {v.inspections.map((i) => <TR key={i.id}><TD className="whitespace-nowrap text-[13px]">{formatInstant(i.inspectedAt, tz)}</TD><TD>{i.driver.user.name}</TD><TD>{i.type === "PRE_TRIP" ? "Pre-trip" : "Post-trip"}</TD><TD><Badge tone={i.hasDefects ? "danger" : "success"}>{i.hasDefects ? "Defects" : "OK"}</Badge></TD><TD className="text-[13px]">{i.defectsSummary ?? "—"}</TD></TR>)}
            {v.inspections.length === 0 && <TR><TD colSpan={5} className="py-6 text-center text-muted-foreground">No inspections.</TD></TR>}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
