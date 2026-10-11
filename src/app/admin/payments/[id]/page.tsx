import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ReasonDialog, FieldInput } from "@/components/admin/dialogs";
import { DocLink } from "@/components/portal/doc-link";
import { AuditTrail } from "@/components/admin/audit-trail";
import { refundPaymentAction } from "@/app/admin/_actions/billing";
import { formatInstant } from "@/lib/dates";
import { centsToDollarInput, formatCents } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Payment" };

export default async function PaymentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ recorded?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("payments.read");
  const p = await prisma.payment.findUnique({ where: { id }, include: { organization: { select: { id: true, name: true } }, allocations: { include: { invoice: { select: { id: true, invoiceNumber: true, totalCents: true, balanceCents: true, status: true } } } }, refunds: { orderBy: { createdAt: "desc" } } } });
  if (!p) notFound();
  const tz = await companyTimeZone();
  const receipt = await prisma.document.findFirst({ where: { paymentId: p.id, type: "RECEIPT", deletedAt: null } });
  const refundable = p.amountCents - p.refundedCents;
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-2">{p.paymentNumber}<StatusBadge kind="payment" status={p.status} /></span>}
        description={`${p.organization.name} · ${formatCents(p.amountCents)}`}
        breadcrumbs={[{ label: "Payments", href: "/admin/payments" }, { label: p.paymentNumber }]}
        actions={<>{receipt && <DocLink id={receipt.id}>Receipt</DocLink>}{hasPermission(actor, "payments.refund") && ["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status) && refundable > 0 && (
          <ReasonDialog trigger={{ label: "Refund", variant: "danger-outline" }} title="Refund payment" description={p.stripePaymentIntentId ? "The refund is issued through Stripe; invoice balances update when Stripe confirms it." : "Offline payment: record a refund you've issued outside the platform."} action={refundPaymentAction} hidden={{ paymentId: p.id }} submitLabel="Issue refund" submitVariant="danger">
            <FieldInput label={`Amount (max ${formatCents(refundable)})`} name="amount" inputMode="decimal" defaultValue={centsToDollarInput(refundable)} required />
          </ReasonDialog>
        )}</>}
      />
      {sp.recorded && <Alert tone="success" title="Payment recorded">Invoice balances were updated and a receipt was generated.</Alert>}
      {p.status === "DISPUTED" && <Alert tone="danger" title="Disputed">Respond to this dispute in the Stripe dashboard. {p.notes}</Alert>}
      {p.status === "FAILED" && <Alert tone="danger" title="Payment failed">{p.failureReason}</Alert>}
      <Card><CardBody><DescriptionList columns={3} items={[{ label: "Customer", value: <Link href={`/admin/customers/${p.organization.id}`} className="text-brand hover:underline">{p.organization.name}</Link> }, { label: "Method", value: p.method === "ACH" ? "Bank (ACH)" : titleCase(p.method) }, { label: "Received", value: p.receivedAt ? formatInstant(p.receivedAt, tz) : "Not settled" }, { label: "Reference", value: p.reference }, { label: "Stripe PaymentIntent", value: p.stripePaymentIntentId }, { label: "Checkout session", value: p.stripeCheckoutSessionId }, { label: "Refunded", value: formatCents(p.refundedCents) }, { label: "Notes", value: p.notes }]} /></CardBody></Card>
      <Card>
        <CardHeader title="Allocations" />
        <Table>
          <THead><tr><TH>Invoice</TH><TH className="text-right">Invoice total</TH><TH className="text-right">Applied</TH><TH>Applied to balance</TH><TH>Invoice status</TH></tr></THead>
          <TBody>{p.allocations.map((a) => <TR key={a.id}><TD><Link href={`/admin/invoices/${a.invoice.id}`} className="font-medium hover:text-brand">{a.invoice.invoiceNumber}</Link></TD><TD className="text-right tabular-nums">{formatCents(a.invoice.totalCents)}</TD><TD className="text-right tabular-nums">{formatCents(a.amountCents)}</TD><TD>{a.applied ? "Yes" : "Pending settlement"}</TD><TD><StatusBadge kind="invoice" status={a.invoice.status} /></TD></TR>)}</TBody>
        </Table>
      </Card>
      {p.refunds.length > 0 && (
        <Card>
          <CardHeader title="Refunds" />
          <Table>
            <THead><tr><TH>Date</TH><TH className="text-right">Amount</TH><TH>Reason</TH><TH>Status</TH><TH>Stripe refund</TH></tr></THead>
            <TBody>{p.refunds.map((r) => <TR key={r.id}><TD className="whitespace-nowrap">{formatInstant(r.createdAt, tz)}</TD><TD className="text-right tabular-nums">{formatCents(r.amountCents)}</TD><TD>{r.reason}</TD><TD>{titleCase(r.status)}</TD><TD className="font-mono text-[12px]">{r.stripeRefundId ?? "—"}</TD></TR>)}</TBody>
          </Table>
        </Card>
      )}
      {hasPermission(actor, "audit.read") && <AuditTrail where={{ entityType: "Payment", entityId: p.id }} title="Payment audit trail" />}
    </div>
  );
}
