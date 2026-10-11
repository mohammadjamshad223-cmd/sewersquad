import Link from "next/link";
import { Download } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { monthlySeries, operationsMetrics, receivablesAging, revenueBreakdowns, serviceContribution } from "@/server/services/analytics";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filters";
import { BarSeries, LineSeries, RankedBars } from "@/components/charts/charts";
import { addDays, dateFromKey, formatDateKey, isDateKey, todayKey } from "@/lib/dates";
import { formatCents, formatGallons, formatNumber, formatPercent } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";

/** Download endpoint (an API route, not a page — a plain link is correct here). */
const AGING_CSV = "/api/export/aging";

export const metadata = { title: "Reports & analytics" };

export default async function Reports({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string }> }) {
  const actor = await requireStaffPage(["reports.operations", "reports.financial"]);
  const sp = await searchParams;
  const fin = hasPermission(actor, "reports.financial");
  const tab = sp.tab ?? (fin ? "financial" : "operations");
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const from = sp.from && isDateKey(sp.from) ? sp.from : addDays(today, -89);
  const to = sp.to && isDateKey(sp.to) ? sp.to : today;
  const qs = `from=${from}&to=${to}`;
  const tabs = [...(fin ? [{ key: "financial", label: "Financial" }, { key: "contribution", label: "Service contribution" }] : []), { key: "operations", label: "Operations" }, { key: "exports", label: "Exports" }];
  return (
    <div>
      <PageHeader title="Reports & analytics" description={`${formatDateKey(from, "long")} – ${formatDateKey(to, "long")}`} />
      <Tabs basePath="/admin/reports" active={tab} tabs={tabs} extra={{ ...(sp.from ? { from } : {}), ...(sp.to ? { to } : {}) }} />
      <Card className="mb-6"><FilterBar dates /></Card>
      {tab === "financial" && fin && <Financial from={from} to={to} qs={qs} />}
      {tab === "contribution" && fin && <Contribution from={from} to={to} qs={qs} />}
      {tab === "operations" && <Operations from={from} to={to} qs={qs} />}
      {tab === "exports" && <Exports qs={qs} fin={fin} />}
    </div>
  );
}

async function Financial({ from, to, qs }: { from: string; to: string; qs: string }) {
  const [series, b, aging, collected, rev] = await Promise.all([
    monthlySeries(12),
    revenueBreakdowns(from, to),
    receivablesAging(),
    prisma.payment.aggregate({ where: { status: { in: ["SUCCEEDED", "PARTIALLY_REFUNDED", "REFUNDED"] }, receivedAt: { gte: dateFromKey(from), lt: dateFromKey(addDays(to, 1)) } }, _sum: { amountCents: true, refundedCents: true }, _count: true }),
    prisma.invoice.aggregate({ where: { status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "PAID", "OVERDUE"] }, issueDate: { gte: dateFromKey(from), lte: dateFromKey(to) } }, _sum: { subtotalCents: true, discountCents: true }, _count: true }),
  ]);
  const revenue = (rev._sum.subtotalCents ?? 0) - (rev._sum.discountCents ?? 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Invoiced revenue" value={formatCents(revenue)} hint={`${rev._count} invoices · excludes tax · by issue date`} />
        <Stat label="Payments collected" value={formatCents((collected._sum.amountCents ?? 0) - (collected._sum.refundedCents ?? 0))} hint={`${collected._count} payments, net of refunds`} />
        <Stat label="Outstanding receivables" value={formatCents(aging.reduce((s, a) => s + a.cents, 0))} />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Revenue by month" action={<a href={`/api/export/revenue?${qs}`} className="text-[13px] font-medium text-brand hover:underline">CSV</a>} /><CardBody><BarSeries data={series} xKey="label" yKey="revenueCents" format="cents" seriesName="Revenue" /></CardBody></Card>
        <Card><CardHeader title="Payments collected by month" /><CardBody><BarSeries data={series} xKey="label" yKey="collectedCents" format="cents" seriesName="Collected" /></CardBody></Card>
        <Card><CardHeader title="Revenue by service type" /><CardBody><RankedBars rows={b.byService.map((r) => ({ name: r.name, value: r.cents }))} /></CardBody></Card>
        <Card><CardHeader title="Revenue by customer (top 10)" /><CardBody><RankedBars rows={b.byCustomer.map((r) => ({ name: r.name, value: r.cents }))} /></CardBody></Card>
        <Card><CardHeader title="Revenue by location (top 10)" /><CardBody><RankedBars rows={b.byLocation.map((r) => ({ name: r.name, value: r.cents }))} /></CardBody></Card>
        <Card><CardHeader title="Revenue by driver" description="Job-linked invoices only." /><CardBody><RankedBars rows={b.byDriver.map((r) => ({ name: r.name, value: r.cents }))} /></CardBody></Card>
      </div>
      <Card>
        <CardHeader title="Accounts receivable aging" action={<a href={AGING_CSV} download className="text-[13px] font-medium text-brand hover:underline">CSV</a>} />
        <Table><THead><tr>{aging.map((a) => <TH key={a.key} className="text-right">{a.label}</TH>)}</tr></THead><TBody><TR>{aging.map((a) => <TD key={a.key} className="text-right tabular-nums">{formatCents(a.cents)}</TD>)}</TR></TBody></Table>
      </Card>
    </div>
  );
}

async function Contribution({ from, to, qs }: { from: string; to: string; qs: string }) {
  const rows = await serviceContribution(from, to);
  const totals = rows.reduce((t, r) => ({ rev: t.rev + r.revenueCents, cost: t.cost + r.directCostCents, contrib: t.contrib + r.contributionCents }), { rev: 0, cost: 0, contrib: 0 });
  const incomplete = rows.filter((r) => !r.complete).length;
  return (
    <div className="space-y-6">
      <Alert tone="info" title="Contribution, not net profit">Contribution = invoice revenue (ex. tax) − allocated direct costs (disposal by gallons, driver labor and truck time from recorded on-site hours). Overhead, fuel and other indirect costs are not included.</Alert>
      {incomplete > 0 && <Alert tone="warning" title={`${incomplete} of ${rows.length} jobs are estimates`}>Missing cost inputs (labor rate, truck cost or disposal allocation) are treated as $0 and the row is labeled an estimate. Set rates on drivers and trucks, and allocate loads to disposal events.</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Revenue" value={formatCents(totals.rev)} />
        <Stat label="Allocated direct costs" value={formatCents(totals.cost)} />
        <Stat label="Contribution margin" value={totals.rev ? formatPercent(totals.contrib / totals.rev) : "—"} hint={formatCents(totals.contrib)} tone={incomplete ? "warning" : "success"} />
      </div>
      <Card>
        <CardHeader title="By job" action={<a href={`/api/export/contribution?${qs}`} className="text-[13px] font-medium text-brand hover:underline">CSV</a>} />
        <Table>
          <THead><tr><TH>Date</TH><TH>Job</TH><TH>Customer / location</TH><TH className="text-right">Gallons</TH><TH className="text-right">Revenue</TH><TH className="text-right">Direct cost</TH><TH className="text-right">Contribution</TH><TH className="text-right">Margin</TH><TH>Basis</TH></tr></THead>
          <TBody>
            {rows.slice(0, 200).map((r) => (
              <TR key={r.jobId}>
                <TD className="whitespace-nowrap">{formatDateKey(r.date)}</TD>
                <TD><Link href={`/admin/jobs/${r.jobId}`} className="font-medium hover:text-brand">{r.jobNumber}</Link></TD>
                <TD>{r.location}<span className="block text-[12px] text-muted-foreground">{r.customer}</span></TD>
                <TD className="text-right tabular-nums">{r.gallons.toLocaleString()}</TD>
                <TD className="text-right tabular-nums">{r.invoiced ? formatCents(r.revenueCents) : <span className="text-muted-foreground">Not invoiced</span>}</TD>
                <TD className="text-right tabular-nums">{formatCents(r.directCostCents)}</TD>
                <TD className="text-right tabular-nums">{formatCents(r.contributionCents)}</TD>
                <TD className="text-right tabular-nums">{formatPercent(r.marginRatio)}</TD>
                <TD>{r.complete ? <Badge tone="success">Complete</Badge> : <Badge tone="warning" title={`Missing: ${r.missing.join(", ")}`}>Estimate</Badge>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}

async function Operations({ from, to, qs }: { from: string; to: string; qs: string }) {
  const [m, series, utilization, missingManifests] = await Promise.all([
    operationsMetrics(from, to),
    monthlySeries(12),
    prisma.$queryRaw<{ unit: string; tank: number; jobs: bigint; gallons: bigint }[]>`
      SELECT v."unitNumber" AS unit, v."tankCapacityGallons" AS tank, COUNT(DISTINCT sr."jobId")::bigint AS jobs, COALESCE(SUM(sar."gallonsPumped"),0)::bigint AS gallons
      FROM "Vehicle" v LEFT JOIN "ServiceRecord" sr ON sr."vehicleId" = v.id AND sr."finishedAt" >= ${dateFromKey(from)} AND sr."finishedAt" < ${dateFromKey(addDays(to, 1))}
      LEFT JOIN "ServiceAssetRecord" sar ON sar."serviceRecordId" = sr.id GROUP BY v.id ORDER BY v."unitNumber"`,
    prisma.job.count({ where: { status: "COMPLETED", scheduledDate: { gte: dateFromKey(from), lte: dateFromKey(to) }, OR: [{ manifest: null }, { manifest: { status: { not: "FINALIZED" } } }] } }),
  ]);
  const totalGallons = m.perDay.reduce((s, d) => s + d.gallons, 0);
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Jobs scheduled" value={m.scheduled} />
        <Stat label="Completed" value={m.completed} hint={`Completion rate ${formatPercent(m.completionRate)}`} tone="success" />
        <Stat label="Missed / unable to service" value={m.missed} tone={m.missed ? "danger" : "neutral"} href="/admin/jobs?status=MISSED" />
        <Stat label="Gallons pumped" value={formatGallons(totalGallons)} hint={`Avg ${formatNumber(m.completed ? totalGallons / Math.max(1, m.perDay.reduce((s, d) => s + d.jobs, 0)) : 0)} gal/job`} />
        <Stat label="Completed without final manifest" value={missingManifests} tone={missingManifests ? "warning" : "neutral"} href="/admin/manifests?status=PENDING_REVIEW" />
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Card><CardHeader title="Jobs completed per day" action={<a href={`/api/export/operations?${qs}`} className="text-[13px] font-medium text-brand hover:underline">CSV</a>} /><CardBody><LineSeries data={m.perDay.map((d) => ({ ...d, label: formatDateKey(d.date, "short").replace(/, \d{4}$/, "") }))} xKey="label" yKey="jobs" seriesName="Jobs" /></CardBody></Card>
        <Card><CardHeader title="Gallons pumped by month" /><CardBody><BarSeries data={series} xKey="label" yKey="gallons" format="gallons" seriesName="Gallons" /></CardBody></Card>
        <Card><CardHeader title="Average gallons per job by month" /><CardBody><LineSeries data={series} xKey="label" yKey="avgGallons" format="gallons" seriesName="Avg gallons / job" /></CardBody></Card>
        <Card><CardHeader title="Jobs per driver" /><CardBody><RankedBars rows={m.perDriver.map((d) => ({ name: d.name, value: d.jobs }))} format="number" /></CardBody></Card>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Driver productivity" />
          <Table><THead><tr><TH>Driver</TH><TH className="text-right">Jobs</TH><TH className="text-right">Gallons</TH><TH className="text-right">Avg / job</TH></tr></THead>
            <TBody>{m.perDriver.map((d) => <TR key={d.name}><TD>{d.name}</TD><TD className="text-right tabular-nums">{d.jobs}</TD><TD className="text-right tabular-nums">{d.gallons.toLocaleString()}</TD><TD className="text-right tabular-nums">{d.jobs ? Math.round(d.gallons / d.jobs).toLocaleString() : "—"}</TD></TR>)}</TBody></Table>
        </Card>
        <Card>
          <CardHeader title="Truck utilization" description="Jobs and gallons collected per truck in the period." />
          <Table><THead><tr><TH>Truck</TH><TH className="text-right">Tank</TH><TH className="text-right">Jobs</TH><TH className="text-right">Gallons</TH><TH className="text-right">Tank loads</TH></tr></THead>
            <TBody>{utilization.map((u) => <TR key={u.unit}><TD>{u.unit}</TD><TD className="text-right tabular-nums">{u.tank.toLocaleString()}</TD><TD className="text-right tabular-nums">{Number(u.jobs)}</TD><TD className="text-right tabular-nums">{Number(u.gallons).toLocaleString()}</TD><TD className="text-right tabular-nums">{(Number(u.gallons) / u.tank).toFixed(1)}</TD></TR>)}</TBody></Table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Emergency response" />
        <CardBody className="grid gap-4 sm:grid-cols-4">
          <Stat label="Requests" value={m.emergency.requests} />
          <Stat label="Avg time to acknowledge" value={m.emergency.avgAckMinutes !== null ? `${Math.round(m.emergency.avgAckMinutes)} min` : "—"} />
          <Stat label="Avg time to dispatch" value={m.emergency.avgDispatchMinutes !== null ? `${Math.round(m.emergency.avgDispatchMinutes)} min` : "—"} />
          <Stat label="Completed" value={m.emergency.completed} />
        </CardBody>
      </Card>
    </div>
  );
}

function Exports({ qs, fin }: { qs: string; fin: boolean }) {
  const list = [
    ...(fin ? [["Revenue (monthly, by service/customer/location)", "revenue"], ["Accounts receivable aging", "aging"], ["Invoices", "invoices"], ["Service contribution by job", "contribution"]] : []),
    ["Operations (jobs/gallons per day, per driver)", "operations"],
    ["Service history (completed jobs)", "service-history"],
    ["Manifest metadata", "manifests"],
    ["Disposal reconciliation", "disposal"],
  ];
  return (
    <Card>
      <CardHeader title="CSV exports" description="Exports use the selected date range and your permissions." />
      <CardBody className="divide-y p-0">
        {list.map(([label, kind]) => <a key={kind} href={`/api/export/${kind}?${qs}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-subtle"><span>{label}</span><Download className="h-4 w-4 text-muted-foreground" /></a>)}
      </CardBody>
    </Card>
  );
}
