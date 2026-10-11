import Link from "next/link";
import { AlertTriangle, Building2, CalendarCheck, CheckCircle2, CircleDollarSign, Droplets, Landmark, MapPin, Siren, Wallet } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { adminKpis, attentionItems, monthlySeries, receivablesAging } from "@/server/services/analytics";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BarSeries } from "@/components/charts/charts";
import { Delta } from "@/components/portal/delta";
import { addDays, dateFromKey, formatDateKey, formatWindow } from "@/lib/dates";
import { formatCents, formatGallons } from "@/lib/money";
import { cn } from "@/lib/utils";

/** Download endpoint (an API route, not a page — a plain link is correct here). */
const AGING_CSV = "/api/export/aging";

export const metadata = { title: "Dashboard" };

export default async function AdminDashboard() {
  const actor = await requireStaffPage();
  const fin = hasPermission(actor, "reports.financial");
  const [k, attention, series, aging] = await Promise.all([adminKpis(), attentionItems(), monthlySeries(12), fin ? receivablesAging() : Promise.resolve([])]);
  const upcoming = await prisma.job.findMany({
    where: { scheduledDate: { gte: dateFromKey(k.today), lte: dateFromKey(addDays(k.today, 3)) }, status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } },
    include: { location: { select: { name: true, city: true } }, driver: { select: { user: { select: { name: true } } } } },
    orderBy: [{ scheduledDate: "asc" }, { priority: "desc" }, { windowStart: "asc" }],
    take: 10,
  });
  const agingMax = Math.max(1, ...aging.map((a) => a.cents));
  const open = attention.filter((a) => a.count > 0);

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={`Operations and finance at a glance · ${formatDateKey(k.today, "long")}`} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {fin && <Stat label="Revenue this month" value={formatCents(k.revenueMonth.value)} hint={<Delta value={k.revenueMonth.value} previous={k.revenueMonth.previous} />} icon={CircleDollarSign} tone="brand" href="/admin/reports" />}
        {fin && <Stat label="Payments collected" value={formatCents(k.collectedMonth.value)} hint={<Delta value={k.collectedMonth.value} previous={k.collectedMonth.previous} />} icon={Wallet} tone="success" href="/admin/payments" />}
        {fin && <Stat label="Outstanding receivables" value={formatCents(k.outstanding.value)} hint={`${k.outstanding.count} open invoices`} icon={Landmark} href="/admin/invoices?status=OPEN" />}
        {fin && <Stat label="Overdue receivables" value={formatCents(k.overdue.value)} hint={`${k.overdue.count} overdue invoices`} icon={AlertTriangle} tone={k.overdue.value ? "danger" : "neutral"} href="/admin/invoices?status=OVERDUE" />}
        <Stat label="Gallons pumped this month" value={formatGallons(k.gallonsMonth.value)} hint={<Delta value={k.gallonsMonth.value} previous={k.gallonsMonth.previous} />} icon={Droplets} tone="brand" />
        <Stat label="Active customers" value={k.activeCustomers} icon={Building2} href="/admin/customers" />
        <Stat label="Active service locations" value={k.activeLocations} icon={MapPin} href="/admin/locations" />
        <Stat label="Jobs scheduled today" value={k.scheduledToday} icon={CalendarCheck} href="/admin/dispatch" />
        <Stat label="Jobs completed today" value={k.completedToday} icon={CheckCircle2} tone="success" />
        <Stat label="Open emergency requests" value={k.emergencies} icon={Siren} tone={k.emergencies ? "danger" : "neutral"} href="/admin/emergencies" />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {fin && (
            <Card>
              <CardHeader title="Monthly revenue" description="Invoiced revenue (excluding tax) by issue month, last 12 months." />
              <CardBody><BarSeries data={series} xKey="label" yKey="revenueCents" format="cents" seriesName="Revenue" /></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Gallons pumped by month" description="From submitted and approved service records." />
            <CardBody><BarSeries data={series} xKey="label" yKey="gallons" format="gallons" seriesName="Gallons" /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Upcoming services" description="Next 3 days" action={<Link href="/admin/dispatch" className="text-[13px] font-medium text-brand hover:underline">Dispatch board</Link>} />
            <Table>
              <THead><tr><TH>Date</TH><TH>Location</TH><TH>Window</TH><TH>Driver</TH><TH>Status</TH></tr></THead>
              <TBody>
                {upcoming.map((j) => (
                  <TR key={j.id}>
                    <TD className="whitespace-nowrap"><Link href={`/admin/jobs/${j.id}`} className="font-medium hover:text-brand">{formatDateKey(j.scheduledDate, "weekday")}</Link>{j.priority === "EMERGENCY" && <Badge tone="danger" className="ml-2">Emergency</Badge>}</TD>
                    <TD>{j.location.name}<span className="block text-[12px] text-muted-foreground">{j.location.city}</span></TD>
                    <TD className="whitespace-nowrap text-[13px]">{formatWindow(j.windowStart, j.windowEnd)}</TD>
                    <TD>{j.driver?.user.name ?? <span className="text-warning">Unassigned</span>}</TD>
                    <TD><StatusBadge kind="job" status={j.status} /></TD>
                  </TR>
                ))}
                {upcoming.length === 0 && <TR><TD colSpan={5} className="py-8 text-center text-muted-foreground">Nothing scheduled in the next 3 days.</TD></TR>}
              </TBody>
            </Table>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Attention required" />
            <CardBody className="space-y-1 p-2">
              {open.length === 0 && <p className="px-3 py-4 text-sm text-muted-foreground">Nothing needs attention right now.</p>}
              {open.map((a) => (
                <Link key={a.key} href={a.href} className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-subtle">
                  <span className="flex items-center gap-2"><AlertTriangle className={cn("h-4 w-4", a.tone === "danger" ? "text-danger" : "text-warning")} aria-hidden />{a.label}</span>
                  <Badge tone={a.tone}>{a.count}</Badge>
                </Link>
              ))}
            </CardBody>
          </Card>
          {fin && (
            <Card>
              <CardHeader title="Accounts receivable aging" action={<a href={AGING_CSV} download className="text-[13px] font-medium text-brand hover:underline">CSV</a>} />
              <CardBody className="space-y-3">
                {aging.map((a, i) => (
                  <div key={a.key} className="text-[13px]">
                    <div className="flex justify-between"><span>{a.label}</span><span className="tabular-nums">{formatCents(a.cents)}</span></div>
                    {/* Sequential single hue (brand green), older buckets darker. */}
                    <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full" style={{ width: `${Math.max(a.cents ? 2 : 0, (a.cents / agingMax) * 100)}%`, background: ["#b7dc8f", "#8dc35a", "#65aa27", "#4a841b", "#2f5a10"][i] }} /></div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
