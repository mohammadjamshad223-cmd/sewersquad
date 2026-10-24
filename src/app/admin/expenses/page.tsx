import Link from "next/link";
import { ChevronLeft, ChevronRight, Receipt, Wallet } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { companyTimeZone } from "@/server/services/settings";
import { EXPENSE_CATEGORY_LABEL, PAID_FROM_LABEL, expenseSummary, expenseWhere } from "@/server/services/expenses";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { DocLink } from "@/components/portal/doc-link";
import { addDays, addMonths, formatDateKey, isDateKey, keyFromDate, startOfMonthKey, todayKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { cn } from "@/lib/utils";
import { ExpenseDialog } from "./expense-form";
import { DeleteExpenseButton, ReimburseButton } from "./row-actions";

export const metadata = { title: "External costs" };

export default async function Expenses({ searchParams }: { searchParams: Promise<{ month?: string; category?: string }> }) {
  const actor = await requireStaffPage("expenses.read");
  const sp = await searchParams;
  const canWrite = hasPermission(actor, "expenses.write");
  const today = todayKey(await companyTimeZone());
  const month = sp.month && isDateKey(`${sp.month}-01`) ? `${sp.month}-01` : startOfMonthKey(today);
  const from = month;
  const to = addDays(addMonths(month, 1), -1);
  const filter = { from, to, category: sp.category };
  const link = (m: string, c = sp.category) => `/admin/expenses?${new URLSearchParams({ month: m.slice(0, 7), ...(c ? { category: c } : {}) })}`;

  const [summary, rows, owedRows, staff, customers] = await Promise.all([
    expenseSummary(filter),
    prisma.expense.findMany({ where: expenseWhere(filter), include: { organization: { select: { name: true } }, documents: { where: { deletedAt: null }, select: { id: true }, orderBy: { createdAt: "desc" } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 500 }),
    prisma.expense.findMany({ where: { deletedAt: null, paidFrom: "PERSONAL", reimbursedAt: null }, orderBy: { date: "asc" }, take: 100 }),
    prisma.user.findMany({ where: { kind: "STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const owedTotal = summary.owed.reduce((s, o) => s + o.cents, 0);
  const opts = {
    categories: Object.entries(EXPENSE_CATEGORY_LABEL).map(([value, label]) => ({ value, label })),
    paidFrom: Object.entries(PAID_FROM_LABEL).map(([value, label]) => ({ value, label })),
    staff,
    customers,
    today,
    me: actor.userId,
  };
  const max = Math.max(1, ...summary.byCategory.map((c) => c.cents));

  return (
    <div className="space-y-5">
      <PageHeader
        title="External costs"
        description="Gas, contractors, tools, permits and other spending. Disposal-site bills are tracked under Disposal."
        actions={canWrite && <ExpenseDialog opts={opts} />}
      />
      <div className="flex items-center gap-2">
        <Button asChild variant="secondary" size="icon" aria-label="Previous month"><Link href={link(addMonths(month, -1))}><ChevronLeft /></Link></Button>
        <p className="min-w-[150px] text-center text-[15px] font-semibold">{new Date(`${month}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</p>
        <Button asChild variant="secondary" size="icon" aria-label="Next month"><Link href={link(addMonths(month, 1))}><ChevronRight /></Link></Button>
        {sp.category && <Link href={link(month, "")} className="ml-2 text-[13px] font-medium text-brand hover:underline">Show all categories</Link>}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={sp.category ? `${EXPENSE_CATEGORY_LABEL[sp.category as keyof typeof EXPENSE_CATEGORY_LABEL] ?? "Costs"} this month` : "Spent this month"} value={formatCents(summary.totalCents)} hint={`${summary.count} cost${summary.count === 1 ? "" : "s"}`} icon={Wallet} tone="brand" />
        <Stat label="Paid from personal money" value={formatCents(summary.byPaidFrom.find((p) => p.paidFrom === "PERSONAL")?.cents ?? 0)} hint="This month" />
        <Stat label="Owed back to people" value={formatCents(owedTotal)} hint={summary.owed.length ? summary.owed.map((o) => `${o.name} ${formatCents(o.cents)}`).join(" · ") : "Nothing owed"} tone={owedTotal ? "warning" : "neutral"} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Costs" />
          {rows.length === 0 ? (
            <EmptyState icon={Receipt} title="No costs recorded this month" description={canWrite ? "Tap “Add cost” to record gas, a contractor, tools or a permit." : undefined} />
          ) : (
            <ul className="divide-y">
              {rows.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium">{e.description}</p>
                    <p className="text-[12px] text-muted-foreground">
                      {formatDateKey(e.date)} · {EXPENSE_CATEGORY_LABEL[e.category]}{e.vendor ? ` · ${e.vendor}` : ""}{e.organization ? ` · for ${e.organization.name}` : ""}
                    </p>
                    <p className={cn("text-[12px]", e.paidFrom === "PERSONAL" && !e.reimbursedAt ? "font-medium text-warning" : "text-muted-foreground")}>
                      {e.paidFrom === "PERSONAL" ? `Paid personally by ${e.paidByName ?? "someone"}${e.reimbursedAt ? ` · paid back ${formatDateKey(keyFromDate(e.reimbursedAt))}` : " · owed back"}` : PAID_FROM_LABEL[e.paidFrom]}
                      {e.documents[0] && <> · <DocLink id={e.documents[0].id} download={false}>Receipt</DocLink></>}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 text-[15px] font-semibold tabular-nums">{formatCents(e.amountCents)}</span>
                    {canWrite && (
                      <>
                        <ExpenseDialog opts={opts} expense={{ id: e.id, date: keyFromDate(e.date), category: e.category, amount: (e.amountCents / 100).toFixed(2), vendor: e.vendor, description: e.description, paidFrom: e.paidFrom, paidByUserId: e.paidByUserId, paidByName: e.paidByName, organizationId: e.organizationId, notes: e.notes }} />
                        <DeleteExpenseButton id={e.id} />
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="By category" />
            <CardBody className="space-y-3">
              {summary.byCategory.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing yet this month.</p>}
              {summary.byCategory.map((c) => (
                <Link key={c.category} href={link(month, c.category)} className="block text-[13px] hover:text-brand">
                  <div className="flex justify-between"><span>{c.label}</span><span className="tabular-nums">{formatCents(c.cents)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-subtle"><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (c.cents / max) * 100)}%` }} /></div>
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Owed back" description="Costs someone covered with their own money, not yet paid back." />
            {owedRows.length === 0 ? (
              <CardBody><p className="text-[13px] text-muted-foreground">Nobody is owed anything.</p></CardBody>
            ) : (
              <ul className="divide-y">
                {owedRows.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0 text-[13px]">
                      <p className="truncate font-medium">{e.paidByName ?? "Someone"} · {formatCents(e.amountCents)}</p>
                      <p className="truncate text-muted-foreground">{formatDateKey(e.date)} · {e.description}</p>
                    </div>
                    {canWrite && <ReimburseButton id={e.id} reimbursed={false} name={e.paidByName ?? "them"} />}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
