import Link from "next/link";
import { CreditCard, Plus } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { integrations } from "@/server/env";
import { stripeIsLiveKey } from "@/server/services/payments";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { formatInstant } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PAYMENT_STATUS } from "@/lib/status";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Payments" };

export default async function Payments({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("payments.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const tz = await companyTimeZone();
  const where: Prisma.PaymentWhereInput = {
    ...(sp.status ? { status: sp.status as never } : { status: { not: "PENDING" } }),
    ...(sp.method ? { method: sp.method as never } : {}),
    ...(sp.q ? { OR: [{ paymentNumber: { contains: sp.q, mode: "insensitive" } }, { reference: { contains: sp.q, mode: "insensitive" } }, { organization: { name: { contains: sp.q, mode: "insensitive" } } }, { stripePaymentIntentId: { contains: sp.q } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.payment.findMany({ where, include: { organization: { select: { name: true } }, allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.payment.count({ where }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" description="Online (Stripe) and manually recorded payments, with their invoice allocations." actions={hasPermission(actor, "payments.record") && <Button asChild><Link href="/admin/payments/new"><Plus /> Record payment</Link></Button>} />
      {!integrations.stripe() ? <Alert tone="warning" title="Stripe is not configured">Online card/ACH payments are disabled until STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set. Manual payments can still be recorded.</Alert> : !stripeIsLiveKey() ? <Alert tone="info" title="Stripe test mode">Online payments use Stripe test keys. Switch to live keys only after verifying webhook delivery in test mode.</Alert> : null}
      <Card>
        <FilterBar search={{ placeholder: "Payment #, reference, customer" }} selects={[{ param: "status", label: "Status", options: Object.entries(PAYMENT_STATUS).map(([value, m]) => ({ value, label: m.label })) }, { param: "method", label: "Method", options: ["CARD", "ACH", "CHECK", "CASH", "OTHER"].map((m) => ({ value: m, label: m === "ACH" ? "ACH" : m.toLowerCase() })) }]} />
        {items.length === 0 ? <EmptyState icon={CreditCard} title="No payments found" /> : (
          <Table>
            <THead><tr><TH>Payment</TH><TH>Customer</TH><TH>Date</TH><TH>Method</TH><TH>Invoices</TH><TH className="text-right">Amount</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/payments/${p.id}`} className="font-medium hover:text-brand">{p.paymentNumber}</Link></TD>
                  <TD>{p.organization.name}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{formatInstant(p.receivedAt ?? p.createdAt, tz)}</TD>
                  <TD>{p.method === "ACH" ? "ACH" : p.method.toLowerCase()}{p.reference && <span className="block max-w-[180px] truncate text-[12px] text-muted-foreground">{p.reference}</span>}</TD>
                  <TD className="text-[13px]">{p.allocations.map((a) => <Link key={a.id} href={`/admin/invoices/${a.invoice.id}`} className="mr-2 text-brand hover:underline">{a.invoice.invoiceNumber}</Link>)}</TD>
                  <TD className="text-right tabular-nums">{formatCents(p.amountCents)}{p.refundedCents > 0 && <span className="block text-[12px] text-muted-foreground">−{formatCents(p.refundedCents)}</span>}</TD>
                  <TD><StatusBadge kind="payment" status={p.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={25} total={total} searchParams={sp} basePath="/admin/payments" />
      </Card>
    </div>
  );
}
