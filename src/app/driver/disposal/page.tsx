import { requireDriverPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { unallocatedLoads } from "@/server/services/disposal";
import { WASTE_TYPES } from "@/lib/status";
import { formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { DisposalForm } from "./disposal-form";

export const metadata = { title: "Record disposal" };

export default async function DriverDisposal() {
  const actor = await requireDriverPage();
  const driver = await prisma.driver.findUniqueOrThrow({ where: { id: actor.driverId } });
  const [vehicles, facilities, recent, tz] = await Promise.all([
    prisma.vehicle.findMany({ where: { status: { notIn: ["OUT_OF_SERVICE"] } }, orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    prisma.disposalFacility.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" } }),
    prisma.disposalEvent.findMany({ where: { driverId: actor.driverId }, orderBy: { disposedAt: "desc" }, take: 5, include: { facility: { select: { name: true } } } }),
    companyTimeZone(),
  ]);
  const vehicleId = driver.defaultVehicleId ?? vehicles[0]?.id ?? null;
  const loads = vehicleId ? await unallocatedLoads(vehicleId, actor.driverId) : [];
  const nowLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T");
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Record disposal</h1>
      <p className="text-[14px] text-muted-foreground">Record each discharge at a disposal facility. Volumes are reconciled against collected loads by the office.</p>
      <DisposalForm vehicles={vehicles} defaultVehicleId={vehicleId} facilities={facilities.map((f) => ({ id: f.id, name: f.name, rate: f.ratePerGallonCents?.toString() ?? null }))} loads={loads} wasteTypes={[...WASTE_TYPES]} now={nowLocal} />
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">Recent disposals</h2>
          {recent.map((e) => <div key={e.id} className="rounded-xl border bg-surface px-4 py-3 text-[14px]">{e.facility.name} · {e.gallons.toLocaleString()} gal<span className="block text-[12px] text-muted-foreground">{e.eventNumber} · {formatInstant(e.disposedAt, tz)}</span></div>)}
        </section>
      )}
    </div>
  );
}
