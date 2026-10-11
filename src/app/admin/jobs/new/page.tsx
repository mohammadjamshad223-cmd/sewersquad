import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ASSET_TYPE_LABEL } from "@/lib/status";
import { todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { JobForm } from "./job-form";

export const metadata = { title: "New job" };

export default async function NewJob({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  await requireStaffPage("jobs.write");
  const [sp, tz] = await Promise.all([searchParams, companyTimeZone()]);
  const [locations, drivers, vehicles] = await Promise.all([
    prisma.serviceLocation.findMany({ where: { deletedAt: null, status: "ACTIVE", organization: { status: "ACTIVE" } }, include: { organization: { select: { name: true } }, assets: { where: { deletedAt: null, status: "ACTIVE" } } }, orderBy: { name: "asc" } }),
    prisma.driver.findMany({ where: { status: "ACTIVE", user: { status: "ACTIVE" } }, select: { id: true, defaultVehicleId: true, user: { select: { name: true } } } }),
    prisma.vehicle.findMany({ where: { status: { notIn: ["MAINTENANCE", "OUT_OF_SERVICE"] } }, select: { id: true, unitNumber: true }, orderBy: { unitNumber: "asc" } }),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="New job" description="Schedule a one-time or emergency visit. Recurring visits are generated from service plans." breadcrumbs={[{ label: "Jobs", href: "/admin/jobs" }, { label: "New" }]} />
      <Card><CardBody>
        <JobForm
          today={todayKey(tz)}
          defaultLocationId={sp.locationId}
          locations={locations.map((l) => ({ id: l.id, label: `${l.name} — ${l.organization.name}`, windowStart: l.defaultWindowStart, windowEnd: l.defaultWindowEnd, assets: l.assets.map((a) => ({ id: a.id, label: `${a.assetTag} · ${ASSET_TYPE_LABEL[a.type]} ${a.capacityGallons.toLocaleString()} gal`, capacity: a.capacityGallons })) }))}
          drivers={drivers.map((d) => ({ id: d.id, name: d.user.name, vehicleId: d.defaultVehicleId }))}
          vehicles={vehicles}
        />
      </CardBody></Card>
    </div>
  );
}
