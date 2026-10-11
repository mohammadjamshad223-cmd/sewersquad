import { requireDriverPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { driverUpcoming } from "@/server/services/driver-portal";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatInstant } from "@/lib/dates";
import { IssueForm } from "./issue-form";

export const metadata = { title: "Report an issue" };

export default async function Issues({ searchParams }: { searchParams: Promise<{ jobId?: string }> }) {
  const actor = await requireDriverPage();
  const [driver, jobs, vehicles, mine] = await Promise.all([
    prisma.driver.findUniqueOrThrow({ where: { id: actor.driverId } }),
    driverUpcoming(actor.driverId, 2),
    prisma.vehicle.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    prisma.issueReport.findMany({ where: { reportedById: actor.userId }, orderBy: { createdAt: "desc" }, take: 8 }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Report an issue</h1>
      <IssueForm jobs={jobs.map((j) => ({ id: j.id, label: `${j.location.name} · ${j.jobNumber}` }))} vehicles={vehicles} defaultVehicleId={driver.defaultVehicleId} defaultJobId={(await searchParams).jobId} />
      {mine.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold">Your reports</h2>
          {mine.map((r) => (
            <div key={r.id} className="rounded-xl border bg-surface px-4 py-3 text-[14px]">
              <div className="flex items-center justify-between gap-2"><span className="font-medium">{r.reportNumber}</span><StatusBadge kind="issue" status={r.status} /></div>
              <p className="mt-1 line-clamp-2 text-muted-foreground">{r.description}</p>
              <p className="mt-1 text-[12px] text-muted-foreground">{formatInstant(r.createdAt)}{r.resolution ? ` · ${r.resolution}` : ""}</p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
