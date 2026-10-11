import { ClipboardList } from "lucide-react";
import { requireDriverPage } from "@/server/authz/guards";
import { driverUpcoming } from "@/server/services/driver-portal";
import { EmptyState } from "@/components/ui/misc";
import { StopCard } from "@/components/driver/stop-card";
import { formatDateKey, keyFromDate } from "@/lib/dates";

export const metadata = { title: "My jobs" };

export default async function DriverJobs() {
  const actor = await requireDriverPage();
  const jobs = await driverUpcoming(actor.driverId);
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) {
    const k = keyFromDate(j.scheduledDate);
    byDay.set(k, [...(byDay.get(k) ?? []), j]);
  }
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold">My jobs</h1>
      {jobs.length === 0 && <EmptyState icon={ClipboardList} title="No upcoming jobs" description="Assigned jobs for the next two weeks appear here." />}
      {[...byDay.entries()].map(([day, list]) => (
        <section key={day} className="space-y-2">
          <h2 className="text-[14px] font-semibold text-muted-foreground">{formatDateKey(day, "weekday")}</h2>
          {list.map((j) => <StopCard key={j.id} stop={j} />)}
        </section>
      ))}
    </div>
  );
}
