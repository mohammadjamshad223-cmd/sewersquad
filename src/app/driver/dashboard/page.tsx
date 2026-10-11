import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Droplets, Route } from "lucide-react";
import { requireDriverPage } from "@/server/authz/guards";
import { driverDay } from "@/server/services/driver-portal";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { StopCard } from "@/components/driver/stop-card";
import { JobActions } from "@/components/driver/job-actions";
import { formatDateKey, dateFromKey } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";

export const metadata = { title: "Today" };

export default async function DriverDashboard() {
  const actor = await requireDriverPage();
  const d = await driverDay(actor.driverId);
  const inspectedToday = d.truck
    ? await prisma.vehicleInspection.count({ where: { driverId: actor.driverId, type: "PRE_TRIP", inspectedAt: { gte: dateFromKey(d.day) } } })
    : 0;
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[14px] text-muted-foreground">{formatDateKey(d.day, "long")}</p>
        <h1 className="text-2xl font-semibold">Hi, {actor.name.split(" ")[0]}</h1>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Stops", d.stats.total],
          ["Done", d.stats.completed],
          ["Left", d.stats.remaining],
        ].map(([l, v]) => (
          <div key={l as string} className="rounded-xl border bg-surface py-3 shadow-card">
            <p className="text-2xl font-semibold tabular-nums">{v}</p>
            <p className="text-[13px] text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between rounded-xl border bg-surface px-4 py-3 text-[14px] shadow-card">
        <span className="flex items-center gap-2"><Droplets className="h-5 w-5 text-brand" /> Est. {d.stats.estimatedGallons.toLocaleString()} gal today</span>
        <span className="text-muted-foreground">{d.truck ? `Truck ${d.truck.unitNumber} · ${d.truck.tankCapacityGallons.toLocaleString()} gal tank` : "No truck"}</span>
      </div>
      {d.capacity?.warnings.map((w) => <Alert key={w} tone="warning" icon={AlertTriangle}>{w}</Alert>)}
      {d.truck && inspectedToday === 0 && (
        <Alert tone="info" icon={ClipboardCheck} title="Pre-trip inspection not recorded today">
          <Link href="/driver/inspections" className="font-medium text-brand underline">Complete inspection</Link>
        </Alert>
      )}
      {d.current ? (
        <section className="space-y-3">
          <h2 className="text-[15px] font-semibold">Current stop</h2>
          <StopCard stop={d.current} highlight index={d.stops.findIndex((s) => s.id === d.current!.id) + 1} />
          <JobActions jobId={d.current.id} status={d.current.status} address={formatAddress(d.current.location)} phone={d.current.location.siteContactPhone} />
        </section>
      ) : (
        <div className="rounded-xl border bg-surface p-6 text-center shadow-card">
          <p className="text-[16px] font-semibold">{d.stats.total ? "Route complete" : "No stops assigned today"}</p>
          <p className="mt-1 text-[14px] text-muted-foreground">{d.stats.total ? "Record your disposal and post-trip inspection before ending the day." : "Dispatch will notify you when jobs are assigned."}</p>
          {d.stats.total > 0 && <Button asChild size="xl" variant="secondary" className="mt-4 w-full"><Link href="/driver/disposal">Record disposal</Link></Button>}
        </div>
      )}
      <Button asChild variant="secondary" size="xl" className="w-full"><Link href="/driver/route"><Route /> View full route</Link></Button>
    </div>
  );
}
