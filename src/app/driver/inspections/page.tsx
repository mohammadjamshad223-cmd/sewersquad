import { requireDriverPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { DEFAULT_INSPECTION_ITEMS } from "@/server/services/fleet";
import { Alert } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { formatInstant } from "@/lib/dates";
import { InspectionForm } from "./inspection-form";

export const metadata = { title: "Vehicle inspection" };

export default async function Inspections() {
  const actor = await requireDriverPage();
  const [driver, vehicles, recent] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: actor.driverId } }),
    prisma.vehicle.findMany({ where: { status: { not: "OUT_OF_SERVICE" } }, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    prisma.vehicleInspection.findMany({ where: { driverId: actor.driverId }, orderBy: { inspectedAt: "desc" }, take: 5, include: { vehicle: { select: { unitNumber: true } } } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Vehicle inspection</h1>
      <Alert tone="info">This checklist is an operational aid for Sewer Squad. It does not replace any inspection or report required by law (for example, DOT driver vehicle inspection reports) unless management has confirmed it meets those requirements.</Alert>
      <InspectionForm vehicles={vehicles} defaultVehicleId={driver.defaultVehicleId} items={[...DEFAULT_INSPECTION_ITEMS]} driverName={actor.name} />
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">Recent inspections</h2>
          {recent.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-xl border bg-surface px-4 py-3 text-[14px]">
              <span>{r.vehicle.unitNumber} · {r.type === "PRE_TRIP" ? "Pre-trip" : "Post-trip"}<span className="block text-[12px] text-muted-foreground">{formatInstant(r.inspectedAt)}</span></span>
              <Badge tone={r.hasDefects ? "danger" : "success"}>{r.hasDefects ? "Defects" : "OK"}</Badge>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
