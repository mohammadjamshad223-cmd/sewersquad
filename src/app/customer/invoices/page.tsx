import Link from "next/link";
import { Download, Receipt } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerInvoices } from "@/server/services/customer-portal";
import { canPayForOrg } from "@/server/authz/scope";
import { integrations } from "@/server/env";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { SelectAll } from "@/components/portal/select-table";
import { formatDateKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { INVOICE_STATUS } from "@/lib/status";
import { PayForm } from "./pay-form";

export const metadata = { title: "Invoices & payments" };
const PAYABLE = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"];

export default async function Invoices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { scope, selectedLocationId, access } = await customerContext();
  const { items, total, pageSize, openBalance, openCount } = await customerInvoices(scope, selectedLocationId, { page, status: sp.status, from: sp.from, to: sp.to, q: sp.q });
  const stripeReady = integrations.stripe();
  const payable = (inv: (typeof items)[number]) => PAYABLE.includes(inv.status) && inv.balanceCents > 0 && canPayForOrg(scope, inv.organizationId, access.readOnlyCanPay);
  const anyPayable = items.some(payable);

  const table = (
    <Table>
      <THead>
        <tr>
          {anyPayable && <TH className="w-10"><SelectAll name="invoiceIds[]" label="Select all payable invoices" /></TH>}
          <TH>Invoice</TH>
          <TH>Date</TH>
          <TH>Due</TH>
          <TH className="hidden md:table-cell">Location</TH>
          <TH className="hidden xl:table-cell">Description</TH>
          <TH className="text-right">Total</TH>
          <TH className="text-right">Balance</TH>
          <TH>Status</TH>
          <TH className="text-right"><span className="sr-only">Actions</span></TH>
        </tr>
      </THead>
      <TBody>
        {items.map((i) => (
          <TR key={i.id}>
            {anyPayable && <TD>{payable(i) && <input type="checkbox" name="invoiceIds[]" value={i.id} aria-label={`Select ${i.invoiceNumber}`} className="h-4 w-4 accent-[hsl(var(--brand))]" />}</TD>}
            <TD className="whitespace-nowrap font-medium"><Link href={`/customer/invoices/${i.id}`} className="hover:text-brand">{i.invoiceNumber}</Link></TD>
            <TD className="whitespace-nowrap">{formatDateKey(i.issueDate)}</TD>
            <TD className="whitespace-nowrap">{formatDateKey(i.dueDate)}</TD>
            <TD className="hidden min-w-[160px] md:table-cell">{i.serviceLocation?.name ?? "Account"}</TD>
            <TD className="hidden xl:table-cell"><span className="block max-w-[240px] truncate text-[13px] text-muted-foreground">{i.lineItems[0]?.description}</span></TD>
            <TD className="text-right tabular-nums">{formatCents(i.totalCents)}</TD>
            <TD className="text-right font-medium tabular-nums">{formatCents(i.balanceCents)}</TD>
            <TD><StatusBadge kind="invoice" status={i.status} /></TD>
            <TD className="whitespace-nowrap text-right">
              <Link href={`/customer/invoices/${i.id}`} className="text-[13px] font-medium text-brand hover:underline">View</Link>
              {i.documents[0] && <DocLink id={i.documents[0].id} className="ml-3">PDF</DocLink>}
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices & payments"
        description="View, download and pay your invoices."
        actions={
          <>
            <Button asChild variant="secondary" size="sm"><Link href="/customer/payments">Payment history</Link></Button>
            <Button asChild variant="secondary" size="sm"><a href={`/api/export/invoices?${new URLSearchParams(Object.entries({ status: sp.status, from: sp.from, to: sp.to, location: selectedLocationId ?? undefined }).filter(([, v]) => v) as [string, string][])}`}><Download /> CSV</a></Button>
          </>
        }
      />
      {sp.cancelled && <Alert tone="info" title="Payment cancelled">No charge was made. Your invoices are unchanged.</Alert>}
      {!stripeReady && <Alert tone="warning" title="Online payments are not available yet">Please pay by check or call our office. Online card and bank payments will be enabled soon.</Alert>}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Outstanding balance" value={formatCents(openBalance)} hint={`${openCount} open invoice${openCount === 1 ? "" : "s"}`} tone={openBalance > 0 ? "warning" : "success"} icon={Receipt} />
      </div>
      <Card>
        <FilterBar
          search={{ placeholder: "Invoice #" }}
          dates
          selects={[{ param: "status", label: "Status", options: [{ value: "OPEN", label: "Open (unpaid)" }, ...Object.entries(INVOICE_STATUS).filter(([k]) => k !== "DRAFT").map(([value, m]) => ({ value, label: m.label }))] }]}
        />
        {items.length === 0 ? (
          <EmptyState icon={Receipt} title="No invoices found" />
        ) : anyPayable ? (
          <PayForm disabled={!stripeReady}>{table}</PayForm>
        ) : (
          table
        )}
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/customer/invoices" />}
      </Card>
    </div>
  );
}
