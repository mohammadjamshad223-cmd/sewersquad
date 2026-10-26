import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { monthProfitDetail } from "@/server/services/analytics";
import { companyTimeZone } from "@/server/services/settings";
import { EXPENSE_CATEGORY_LABEL, PAID_FROM_LABEL } from "@/server/services/expenses";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DisposalCostForm } from "@/components/admin/disposal-cost-form";
import { ExpenseDialog } from "@/app/admin/expenses/expense-form";
import { addMonths, formatDateKey, isDateKey, keyFromDate, startOfMonthKey, todayKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";

export const metadata = { title: "Profit" };

const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : "—");

/** "Profit this month": revenue, dumping fees per job (editable), external costs, and what's left. */
export default async function Profit({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const actor = await requireStaffPage("reports.financial");
  const sp = await searchParams;
  const today = todayKey(await companyTimeZone());
  const month = sp.month && isDateKey(`${sp.month}-01`) ? `${sp.month}-01` : startOfMonthKey(today);
  const d = await monthProfitDetail(month);
  const canEditDisposal = hasPermission(actor, "invoices.write");
  const canEditCosts = hasPermission(actor, "expenses.write");
  const avg = d.averageDisposalCents !== null ? Math.round(d.averageDisposalCents * 10) / 10 : null;
  const link = (m: string) => `/admin/profit?month=${m.slice(0, 7)}`;
  const [staff, customers] = canEditCosts
    ? await Promise.all([
        prisma.user.findMany({ where: { kind: "STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
        prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
      ])
    : [[], []];
  const opts = { categories: Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({ value, label })), paidFrom: Object.entries(PAID_FROM_LABEL).map(([value, label]) => ({ value, label })), staff, customers, today, me: actor.userId };

  return (
    <div className="space-y-5">
      <PageHeader title="Profit" description="Revenue minus dumping fees and external costs, for the month." breadcrumbs={[{ label: "Dashboard", href: "/admin/dashboard" }, { label: "Profit" }]} />
      <div className="flex items-center gap-2">
        <Button asChild variant="secondary" size="icon" aria-label="Previous month"><Link href={link(addMonths(month, -1))}><ChevronLeft /></Link></Button>
        <p className="min-w-[150px] text-center text-[15px] font-semibold">{new Date(`${month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
        <Button asChild variant="secondary" size="icon" aria-label="Next month"><Link href={link(addMonths(month, 1))}><ChevronRight /></Link></Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Revenue" value={formatCents(d.revenueCents)} hint={`${d.jobs.length} invoice${d.jobs.length === 1 ? "" : "s"}`} tone="brand" />
        <Stat label="Dumping fees" value={d.disposalCents ? `−${formatCents(d.disposalCents)}` : formatCents(0)} hint={d.usingAverage ? `${d.usingAverage} using the average` : "All entered"} tone={d.usingAverage ? "warning" : "neutral"} />
        <Stat label="External costs" value={d.otherCostsCents ? `−${formatCents(d.otherCostsCents)}` : formatCents(0)} hint={`${d.expenses.length} cost${d.expenses.length === 1 ? "" : "s"}`} href={`/admin/expenses?month=${d.month}`} />
        <Stat label="Profit" value={formatCents(d.profitCents)} hint={`${pct(d.profitCents, d.revenueCents)} margin`} tone={d.profitCents < 0 ? "danger" : "success"} />
      </div>

      {d.usingAverage > 0 && (
        <Alert tone="warning" title={`${d.usingAverage} job${d.usingAverage === 1 ? "" : "s"} without a dumping fee entered`}>
          They&apos;re counted at your average{avg !== null ? ` of ${avg}¢ per gallon` : ""}. If one was waste water or nothing was dumped, set it to 0¢ below.
        </Alert>
      )}

      <Card>
        <CardHeader title="Dumping fees by job" description="What dumping each job's waste cost. Change any of them here — internal only, never shown to customers." />
        {d.jobs.length === 0 ? (
          <CardBody><p className="text-[13px] text-muted-foreground">No invoices this month.</p></CardBody>
        ) : (
          <ul className="divide-y">
            {d.jobs.map((j) => (
              <li key={j.id} className={cn("space-y-2 px-4 py-3", j.source === "average" && "bg-warning-soft/40")}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/admin/invoices/${j.id}`} className="text-[14px] font-semibold hover:text-brand">{j.invoiceNumber} · {j.location ?? j.customer}</Link>
                    <p className="text-[12px] text-muted-foreground">{formatDateKey(keyFromDate(j.issueDate))}{j.service ? ` · ${j.service}` : ""}{j.hauls && j.gallons ? ` · ${j.gallons.toLocaleString()} gal` : ""}</p>
                  </div>
                  <div className="text-right text-[13px]">
                    <p className="tabular-nums">{formatCents(j.revenueCents)} <span className="text-muted-foreground">− {formatCents(j.disposalCents)}</span> = <span className="font-semibold">{formatCents(j.profitCents)}</span></p>
                    <p className={cn("text-[12px]", j.source === "average" ? "font-medium text-warning" : "text-muted-foreground")}>
                      {j.source === "entered" ? `Dumping: ${j.rateCents}¢/gal entered` : j.source === "average" ? `Dumping: average${avg !== null ? ` ${avg}¢/gal` : ""} — not entered` : "Nothing hauled — no dumping fee"}
                    </p>
                  </div>
                </div>
                {canEditDisposal && (j.hauls || j.source === "entered") && <DisposalCostForm invoiceId={j.id} current={j.source === "entered" ? String(j.rateCents) : null} averageCents={d.averageDisposalCents} />}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader title="External costs" description="Gas, contractors, tools, permits…" action={canEditCosts && <ExpenseDialog opts={opts} />} />
        {d.expenses.length === 0 ? (
          <CardBody><p className="text-[13px] text-muted-foreground">No external costs this month.</p></CardBody>
        ) : (
          <ul className="divide-y">
            {d.expenses.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-medium">{e.description}</p>
                  <p className="truncate text-[12px] text-muted-foreground">{formatDateKey(keyFromDate(e.date))} · {EXPENSE_CATEGORY_LABEL[e.category]}{e.vendor ? ` · ${e.vendor}` : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="text-[14px] font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                  {canEditCosts && <ExpenseDialog opts={opts} expense={{ id: e.id, date: keyFromDate(e.date), category: e.category, amount: (e.amountCents / 100).toFixed(2), vendor: e.vendor, description: e.description, paidFrom: e.paidFrom, paidByUserId: e.paidByUserId, paidByName: e.paidByName, organizationId: e.organizationId, notes: e.notes }} />}
                </div>
              </li>
            ))}
          </ul>
        )}
        <CardBody className="border-t pt-3"><Link href={`/admin/expenses?month=${d.month}`} className="text-[13px] font-medium text-brand hover:underline">Open External costs for more detail</Link></CardBody>
      </Card>
    </div>
  );
}
