import Link from "next/link";
import { AlertTriangle, Route as RouteIcon } from "lucide-react";
import { requireDriverPage } from "@/server/authz/guards";
import { driverDay } from "@/server/services/driver-portal";
import { Alert, EmptyState } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { StopCard } from "@/components/driver/stop-card";
import { formatDateKey } from "@/lib/dates";
import { formatAddress } from "@/lib/utils";

export const metadata = { title: "Today's route" };

export default async function DriverRoute() {
  const actor = await requireDriverPage();
  const d = await driverDay(actor.driverId);
  const open = d.stops.filter((s) => !["SUBMITTED", "COMPLETED", "UNABLE_TO_SERVICE"].includes(s.status));
  // Multi-stop directions in the order dispatch set (Google supports up to ~9 waypoints in a URL).
  const dirs = open.length
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(formatAddress(open.at(-1)!.location))}${open.length > 1 ? `&waypoints=${open.slice(0, -1).slice(0, 9).map((s) => encodeURIComponent(formatAddress(s.location))).join("%7C")}` : ""}`
    : null;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Today&apos;s route</h1>
        <p className="text-[14px] text-muted-foreground">{formatDateKey(d.day, "long")} · {d.stats.total} stops · est. {d.stats.estimatedGallons.toLocaleString()} gal</p>
      </div>
      {d.capacity?.warnings.map((w) => <Alert key={w} tone="warning" icon={AlertTriangle}>{w}</Alert>)}
      {dirs && <Button asChild size="xl" className="w-full"><a href={dirs} target="_blank" rel="noopener"><RouteIcon /> Directions for remaining stops</a></Button>}
      <p className="text-[12px] text-muted-foreground">Stop order is set by dispatch. Directions open in your maps app; travel time estimates come from that app.</p>
      {d.stops.length === 0 ? (
        <EmptyState icon={RouteIcon} title="No stops today" />
      ) : (
        <ol className="space-y-3">
          {d.stops.map((s, i) => <li key={s.id}><StopCard stop={s} index={i + 1} highlight={s.id === d.current?.id} /></li>)}
        </ol>
      )}
      <Button asChild variant="secondary" size="lg" className="w-full"><Link href="/driver/issues">Report an issue</Link></Button>
    </div>
  );
}
