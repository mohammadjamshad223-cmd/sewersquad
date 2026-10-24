import Link from "next/link";
import { AlertTriangle, CircleDollarSign, Droplets, Landmark, TrendingUp, Wallet } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { adminKpis, attentionItems, grossProfitByMonth, monthlySeries } from "@/server/services/analytics";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BarSeries } from "@/components/charts/charts";
import { Delta } from "@/components/portal/delta";
import { addDays, dateFromKey, formatDateKey } from "@/lib/dates";
import { formatCents, formatGallons } from "@/lib/money";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(0)}%`);

export default async function AdminDashboard() {
  const actor = await requireStaffPage();
  const fin = hasPermission(actor, "reports.financial");
  const [k, attention, series, profit] = await Promise.all([adminKpis(), attentionItems(), fin ? monthlySeries(12) : Promise.resolve([]), fin ? grossProfitByMonth(6) : Promise.resolve(null)]);
  const upcoming = await prisma.job.findMany({
    where: { scheduledDate: { gte: dateFromKey(k.today), lte: dateFromKey(addDays(k.today, 7)) }, status: { in: ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"] } },
    include: { location: { select: { name: true, city: true } } },
    orderBy: [{ scheduledDate: "asc" }, { priority: "desc" }],
    take: 8,
  });
  const open = attention.filter((a) => a.count > 0 && !["emergencies", "unassigned", "overdueInvoices"].includes(a.key)).map((a) => (a.key === "overdueServices" ? { ...a, href: "/admin/dispatch" } : a));
  const thisMonth = profit?.months[0];

  return (
    <div className="space-y-6">
      <PageHeader title="Dashboard" description={formatDateKey(k.today, "long")} />

      {fin && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Revenue this month" value={formatCents(k.revenueMonth.value)} hint={<Delta value={k.revenueMonth.value} previous={k.revenueMonth.previous} />} icon={CircleDollarSign} tone="brand" href="/admin/invoices" />
          <Stat label="Payments collected" value={formatCents(k.collectedMonth.value)} hint={<Delta value={k.collectedMonth.value} previous={k.collectedMonth.previous} />} icon={Wallet} tone="success" href="/admin/payments" />
          <Stat label="Outstanding" value={formatCents(k.outstanding.value)} hint={k.outstanding.count ? `${k.outstanding.count} open invoice${k.outstanding.count > 1 ? "s" : ""}${k.overdue.count ? ` · ${k.overdue.count} past due` : ""}` : "All paid up"} icon={Landmark} tone={k.overdue.value ? "warning" : "neutral"} href="/admin/invoices?status=OPEN" />
          <Stat label="Profit this month" value={thisMonth ? formatCents(thisMonth.profitCents) : "—"} hint={thisMonth ? `${pct(thisMonth.marginPct)} margin after disposal & other costs` : undefined} icon={TrendingUp} tone="success" href="/admin/expenses" />
        </div>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          {profit && (
            <Card>
              <CardHeader
                title="Profitability"
                description={profit.centsPerGallon !== null ? `Revenue minus disposal (at your average $${(profit.centsPerGallon / 100).toFixed(3)} per gallon from disposal-site bills) and other costs from External costs.` : "Add disposal-site bills (Disposal → Fees & bills) to calculate disposal cost per gallon."}
              />
              <Table>
                <THead>
                  <tr><TH>Month</TH><TH className="text-right">Revenue</TH><TH className="hidden text-right sm:table-cell">Gallons</TH><TH className="hidden text-right sm:table-cell">Disposal cost</TH><TH className="hidden text-right sm:table-cell">Other costs</TH><TH className="text-right">Profit</TH><TH className="text-right">Margin</TH></tr>
                </THead>
                <TBody>
                  {profit.months.map((m, i) => (
                    <TR key={m.month} className={cn(i === 0 && "bg-brand-soft/40 font-medium")}>
                      <TD className="whitespace-nowrap">{m.label}{i === 0 && <Badge className="ml-2 hidden sm:inline-flex">This month</Badge>}</TD>
                      <TD className="text-right tabular-nums">{formatCents(m.revenueCents)}</TD>
                      <TD className="hidden text-right tabular-nums sm:table-cell">{m.gallons ? m.gallons.toLocaleString() : "—"}</TD>
                      <TD className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{m.disposalCents ? `−${formatCents(m.disposalCents)}` : "—"}</TD>
                      <TD className="hidden text-right tabular-nums text-muted-foreground sm:table-cell">{m.otherCostsCents ? <Link href={`/admin/expenses?month=${m.month}`} className="hover:text-brand">−{formatCents(m.otherCostsCents)}</Link> : "—"}</TD>
                      <TD className={cn("text-right font-semibold tabular-nums", m.profitCents < 0 && "text-danger")}>{formatCents(m.profitCents)}</TD>
                      <TD className="text-right tabular-nums">{pct(m.marginPct)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
          {fin && (
            <Card>
              <CardHeader title="Revenue by month" description="Invoiced revenue (before tax), last 12 months." />
              <CardBody><BarSeries data={series} xKey="label" yKey="revenueCents" format="cents" seriesName="Revenue" /></CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="This week" action={<Link href="/admin/dispatch" className="text-[13px] font-medium text-brand hover:underline">Dispatch board</Link>} />
            <CardBody className="space-y-3 pt-0">
              <div className="grid grid-cols-2 gap-3 text-center">
                <Link href="/admin/dispatch" className="rounded-lg border p-3 hover:border-brand/30"><p className="text-xl font-semibold tabular-nums">{k.scheduledToday}</p><p className="text-[12px] text-muted-foreground">Jobs today</p></Link>
                <div className="rounded-lg border p-3"><p className="flex items-center justify-center gap-1 text-xl font-semibold tabular-nums"><Droplets className="h-4 w-4 text-brand" />{formatGallons(k.gallonsMonth.value).replace(/ gal$/, "")}</p><p className="text-[12px] text-muted-foreground">Gallons this month</p></div>
              </div>
              <ul className="divide-y text-[14px]">
                {upcoming.map((j) => (
                  <li key={j.id} className="flex items-center justify-between gap-3 py-2">
                    <Link href={`/admin/jobs/${j.id}`} className="min-w-0 hover:text-brand"><span className="block truncate font-medium">{j.location.name}</span><span className="block truncate text-[12px] text-muted-foreground">{SERVICE_TYPE_LABEL[j.serviceType]} · {j.location.city}</span></Link>
                    <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{formatDateKey(j.scheduledDate, "weekday")}</span>
                  </li>
                ))}
                {upcoming.length === 0 && <li className="py-4 text-center text-muted-foreground">Nothing scheduled this week.</li>}
              </ul>
            </CardBody>
          </Card>
          {open.length > 0 && (
            <Card>
              <CardHeader title="Needs attention" />
              <CardBody className="space-y-1 p-2">
                {open.map((a) => (
                  <Link key={a.key} href={a.href} className="flex items-center justify-between gap-3 rounded-md px-3 py-2.5 text-sm hover:bg-subtle">
                    <span className="flex items-center gap-2"><AlertTriangle className={cn("h-4 w-4", a.tone === "danger" ? "text-danger" : "text-warning")} aria-hidden />{a.label}</span>
                    <Badge tone={a.tone}>{a.count}</Badge>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
