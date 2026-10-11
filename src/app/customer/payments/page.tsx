import Link from "next/link";
import { CreditCard } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerPayments } from "@/server/services/customer-portal";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { DocLink } from "@/components/portal/doc-link";
import { formatInstant } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Payment history" };

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { scope, selectedLocationId } = await customerContext();
  const [{ items, total, pageSize }, tz] = await Promise.all([customerPayments(scope, selectedLocationId, page), companyTimeZone()]);
  return (
    <div>
      <PageHeader title="Payment history" description="Payments applied to your invoices." breadcrumbs={[{ label: "Invoices & payments", href: "/customer/invoices" }, { label: "Payment history" }]} />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={CreditCard} title="No payments yet" />
        ) : (
          <Table>
            <THead><tr><TH>Payment</TH><TH>Date</TH><TH>Method</TH><TH>Invoices</TH><TH className="text-right">Amount</TH><TH>Status</TH><TH className="text-right">Receipt</TH></tr></THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium">{p.paymentNumber}</TD>
                  <TD className="whitespace-nowrap">{formatInstant(p.receivedAt ?? p.createdAt, tz, "date")}</TD>
                  <TD>{p.method === "ACH" ? "Bank (ACH)" : p.method === "CARD" ? "Card" : p.method.toLowerCase()}</TD>
                  <TD className="text-[13px]">{p.allocations.map((a) => <Link key={a.id} href={`/customer/invoices/${a.invoice.id}`} className="mr-2 text-brand hover:underline">{a.invoice.invoiceNumber}</Link>)}</TD>
                  <TD className="text-right tabular-nums">{formatCents(p.amountCents)}{p.refundedCents > 0 && <span className="block text-[12px] text-muted-foreground">−{formatCents(p.refundedCents)} refunded</span>}</TD>
                  <TD><StatusBadge kind="payment" status={p.status} /></TD>
                  <TD className="text-right">{p.receiptId ? <DocLink id={p.receiptId}>Receipt</DocLink> : "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/customer/payments" />}
      </Card>
    </div>
  );
}
