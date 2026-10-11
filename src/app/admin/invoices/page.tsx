import Link from "next/link";
import { Download, Plus, Receipt } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { dateFromKey, formatDateKey, isDateKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/status";

export const metadata = { title: "Invoices" };
const OPEN = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as const;

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("invoices.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const where: Prisma.InvoiceWhereInput = {
    ...(sp.status === "OPEN" ? { status: { in: [...OPEN] } } : sp.status ? { status: sp.status as never } : {}),
    ...(sp.org ? { organizationId: sp.org } : {}),
    ...(sp.from || sp.to ? { issueDate: { ...(sp.from && isDateKey(sp.from) ? { gte: dateFromKey(sp.from) } : {}), ...(sp.to && isDateKey(sp.to) ? { lte: dateFromKey(sp.to) } : {}) } } : {}),
    ...(sp.q ? { OR: [{ invoiceNumber: { contains: sp.q, mode: "insensitive" } }, { organization: { name: { contains: sp.q, mode: "insensitive" } } }, { serviceLocation: { name: { contains: sp.q, mode: "insensitive" } } }, { poNumber: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [items, total, open, overdue, drafts, orgs] = await Promise.all([
    prisma.invoice.findMany({ where, include: { organization: { select: { name: true } }, serviceLocation: { select: { name: true } } }, orderBy: [{ issueDate: "desc" }, { invoiceNumber: "desc" }], skip: (page - 1) * 25, take: 25 }),
    prisma.invoice.count({ where }),
    prisma.invoice.aggregate({ where: { status: { in: [...OPEN] } }, _sum: { balanceCents: true }, _count: true }),
    prisma.invoice.aggregate({ where: { status: "OVERDUE" }, _sum: { balanceCents: true }, _count: true }),
    prisma.invoice.count({ where: { status: "DRAFT" } }),
    prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Invoices" actions={<>{hasPermission(actor, "invoices.write") && <Button asChild><Link href="/admin/invoices/new"><Plus /> New invoice</Link></Button>}<Button asChild variant="secondary"><a href={`/api/export/invoices?${new URLSearchParams(Object.entries({ status: sp.status === "OPEN" ? undefined : sp.status, from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][])}`}><Download /> CSV</a></Button></>} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding" value={formatCents(open._sum.balanceCents ?? 0)} hint={`${open._count} open invoices`} href="/admin/invoices?status=OPEN" />
        <Stat label="Overdue" value={formatCents(overdue._sum.balanceCents ?? 0)} hint={`${overdue._count} invoices`} tone={overdue._count ? "danger" : "neutral"} href="/admin/invoices?status=OVERDUE" />
        <Stat label="Drafts to review" value={drafts} hint="Not visible to customers" href="/admin/invoices?status=DRAFT" tone={drafts ? "warning" : "neutral"} />
      </div>
      <Card>
        <FilterBar search={{ placeholder: "Invoice #, customer, location, PO" }} dates selects={[{ param: "status", label: "Status", options: [{ value: "OPEN", label: "Open" }, ...Object.entries(INVOICE_STATUS).map(([value, m]) => ({ value, label: m.label }))] }, { param: "org", label: "Customer", options: orgs.map((o) => ({ value: o.id, label: o.name })) }]} />
        {items.length === 0 ? <EmptyState icon={Receipt} title="No invoices found" /> : (
          <Table>
            <THead><tr><TH>Invoice</TH><TH>Customer</TH><TH>Issued</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Balance</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/invoices/${i.id}`} className="font-medium hover:text-brand">{i.invoiceNumber}</Link></TD>
                  <TD>{i.organization.name}<span className="block text-[12px] text-muted-foreground">{i.serviceLocation?.name ?? "Account level"}</span></TD>
                  <TD className="whitespace-nowrap">{formatDateKey(i.issueDate)}</TD>
                  <TD className="whitespace-nowrap">{formatDateKey(i.dueDate)}</TD>
                  <TD className="text-right tabular-nums">{formatCents(i.totalCents)}</TD>
                  <TD className="text-right font-medium tabular-nums">{formatCents(i.balanceCents)}</TD>
                  <TD><StatusBadge kind="invoice" status={i.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={25} total={total} searchParams={sp} basePath="/admin/invoices" />
      </Card>
    </div>
  );
}
