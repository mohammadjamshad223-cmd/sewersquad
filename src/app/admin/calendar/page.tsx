import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { addDays, addMonths, dateFromKey, isDateKey, keyFromDate, startOfMonthKey, todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "Service calendar" };

export default async function Calendar({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  await requireStaffPage("jobs.read");
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const sp = await searchParams;
  const month = sp.month && isDateKey(`${sp.month}-01`) ? `${sp.month}-01` : startOfMonthKey(today);
  const gridStart = addDays(month, -((new Date(`${month}T00:00:00Z`).getUTCDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const jobs = await prisma.job.findMany({
    where: { scheduledDate: { gte: dateFromKey(days[0]!), lte: dateFromKey(days[41]!) }, status: { not: "CANCELLED" } },
    select: { id: true, scheduledDate: true, status: true, priority: true, driverId: true, location: { select: { name: true } } },
    orderBy: [{ priority: "desc" }, { windowStart: "asc" }],
  });
  const byDay = new Map<string, typeof jobs>();
  for (const j of jobs) byDay.set(keyFromDate(j.scheduledDate), [...(byDay.get(keyFromDate(j.scheduledDate)) ?? []), j]);
  const label = new Date(`${month}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const m = (k: string) => `/admin/calendar?month=${k.slice(0, 7)}`;
  return (
    <div>
      <PageHeader title="Service calendar" description={label} actions={<><Button asChild variant="secondary" size="icon" aria-label="Previous month"><Link href={m(addMonths(month, -1))}><ChevronLeft /></Link></Button><Button asChild variant="secondary" size="sm"><Link href={m(today)}>This month</Link></Button><Button asChild variant="secondary" size="icon" aria-label="Next month"><Link href={m(addMonths(month, 1))}><ChevronRight /></Link></Button></>} />
      <Card className="overflow-hidden">
        <div className="grid grid-cols-7 border-b bg-subtle/60 text-[12px] font-medium uppercase tracking-wide text-muted-foreground">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-2">{d}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((d) => {
            const list = byDay.get(d) ?? [];
            const inMonth = d.slice(0, 7) === month.slice(0, 7);
            const unassigned = list.filter((j) => !j.driverId && j.status === "SCHEDULED").length;
            return (
              <Link key={d} href={`/admin/dispatch?date=${d}`} className={cn("min-h-[112px] border-b border-r p-2 text-[12px] hover:bg-subtle/60", !inMonth && "bg-subtle/30 text-muted-foreground")} aria-label={`${d}: ${list.length} jobs`}>
                <div className="flex items-center justify-between">
                  <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium", d === today && "bg-brand text-brand-foreground")}>{Number(d.slice(8))}</span>
                  {list.length > 0 && <span className="tabular-nums text-muted-foreground">{list.length}</span>}
                </div>
                <ul className="mt-1 space-y-0.5">
                  {list.slice(0, 3).map((j) => <li key={j.id} className={cn("truncate rounded px-1 py-0.5", j.priority === "EMERGENCY" ? "bg-danger-soft text-danger" : j.status === "COMPLETED" || j.status === "SUBMITTED" ? "bg-success-soft text-success" : "bg-brand-soft text-brand")}>{j.location.name}</li>)}
                  {list.length > 3 && <li className="px-1 text-muted-foreground">+{list.length - 3} more</li>}
                </ul>
                {unassigned > 0 && <p className="mt-1 text-[11px] font-medium text-warning">{unassigned} unassigned</p>}
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
