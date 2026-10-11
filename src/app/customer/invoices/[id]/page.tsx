import { idParam } from "@/server/params";
import Link from "next/link";
import { notFound } from "next/navigation";
import { customerContext } from "@/server/customer-context";
import { customerInvoice } from "@/server/services/customer-portal";
import { markInvoiceViewed } from "@/server/services/invoices";
import { canPayForOrg } from "@/server/authz/scope";
import { integrations } from "@/server/env";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DocLink } from "@/components/portal/doc-link";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { centsToDollarInput, formatCents, formatRateCents } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";
import { PaySingle } from "../pay-form";

export const metadata = { title: "Invoice" };

export default async function InvoiceDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const { scope, access } = await customerContext();
  let inv;
  try {
    inv = await customerInvoice(scope, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  await markInvoiceViewed(inv.id);
  const tz = await companyTimeZone();
  const payable = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status) && inv.balanceCents > 0;
  const canPay = canPayForOrg(scope, inv.organizationId, access.readOnlyCanPay);
  const processing = inv.allocations.some((a) => a.payment.status === "PROCESSING");
  const pdf = inv.documents.find((d) => d.type === "INVOICE");
  return (
    <div className="space-y-6">
      <PageHeader
        title={`Invoice ${inv.invoiceNumber}`}
        description={`${inv.organization.name} · ${inv.serviceLocation?.name ?? "Account level"}`}
        breadcrumbs={[{ label: "Invoices & payments", href: "/customer/invoices" }, { label: inv.invoiceNumber }]}
        actions={<><StatusBadge kind="invoice" status={inv.status} />{pdf && <DocLink id={pdf.id}>Download PDF</DocLink>}</>}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <Card>
            <CardBody>
              <DescriptionList
                columns={3}
                items={[
                  { label: "Issued", value: formatDateKey(inv.issueDate, "long") },
                  { label: "Due", value: formatDateKey(inv.dueDate, "long") },
                  { label: "Terms", value: `Net ${inv.paymentTermsDays}` },
                  { label: "Service date", value: inv.serviceDate ? formatDateKey(inv.serviceDate) : "—" },
                  { label: "Service", value: inv.job ? <Link href={`/customer/services/${inv.job.id}`} className="text-brand hover:underline">{inv.job.jobNumber}</Link> : "—" },
                  { label: "Manifest", value: inv.manifest?.manifestNumber ?? "—" },
                ]}
              />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Line items" />
            <Table>
              <THead><tr><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit price</TH><TH className="text-right">Amount</TH></tr></THead>
              <TBody>
                {inv.lineItems.map((l) => (
                  <TR key={l.id}>
                    <TD>{l.description}</TD>
                    <TD className="text-right tabular-nums">{Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 })}</TD>
                    <TD className="text-right tabular-nums">{formatRateCents(l.unitPriceCents.toString())}</TD>
                    <TD className="text-right tabular-nums">{formatCents(l.amountCents)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="ml-auto max-w-xs space-y-1.5 px-5 py-4 text-sm">
              <Row label="Subtotal" value={formatCents(inv.subtotalCents)} />
              {inv.discountCents > 0 && <Row label="Discounts" value={`−${formatCents(inv.discountCents)}`} />}
              <Row label={`Tax (${(inv.taxRateBps / 100).toFixed(2)}%)`} value={formatCents(inv.taxCents)} />
              <Row label="Total" value={formatCents(inv.totalCents)} strong />
              {inv.amountPaidCents > 0 && <Row label="Paid" value={`−${formatCents(inv.amountPaidCents)}`} />}
              <Row label="Balance due" value={formatCents(inv.balanceCents)} strong />
            </div>
          </Card>
          {inv.allocations.length > 0 && (
            <Card>
              <CardHeader title="Payments applied" />
              <Table>
                <THead><tr><TH>Payment</TH><TH>Date</TH><TH>Method</TH><TH>Status</TH><TH className="text-right">Applied</TH></tr></THead>
                <TBody>
                  {inv.allocations.map((a) => (
                    <TR key={a.id}>
                      <TD className="font-medium">{a.payment.paymentNumber}</TD>
                      <TD>{formatInstant(a.payment.receivedAt ?? a.payment.createdAt, tz, "date")}</TD>
                      <TD>{a.payment.method === "ACH" ? "Bank (ACH)" : a.payment.method === "CARD" ? "Card" : a.payment.method.toLowerCase()}</TD>
                      <TD><StatusBadge kind="payment" status={a.payment.status} /></TD>
                      <TD className="text-right tabular-nums">{formatCents(a.amountCents)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={payable ? "Pay this invoice" : "Payment"} />
            <CardBody className="space-y-3">
              <p className="text-3xl font-semibold tabular-nums">{formatCents(inv.balanceCents)}</p>
              {processing && <Alert tone="info" title="Bank payment processing">Bank (ACH) payments can take a few business days to settle. Your balance updates once it clears.</Alert>}
              {payable && !processing && canPay && integrations.stripe() && <PaySingle invoiceId={inv.id} balance={centsToDollarInput(inv.balanceCents)} allowPartial={inv.allowPartial} />}
              {payable && !canPay && <p className="text-[13px] text-muted-foreground">Your user role can view invoices but not make payments. Ask your organization admin.</p>}
              {payable && !integrations.stripe() && <p className="text-[13px] text-muted-foreground">Online payment isn&apos;t enabled yet. Please pay by check or call our office.</p>}
              {!payable && <p className="text-[13px] text-muted-foreground">{inv.status === "PAID" ? "Paid in full — thank you." : "This invoice is not open for payment."}</p>}
              {inv.documents.filter((d) => d.type === "RECEIPT").map((d) => <DocLink key={d.id} id={d.id}>Download receipt</DocLink>)}
            </CardBody>
          </Card>
          <Card>
            <CardBody className="text-[13px] text-muted-foreground">
              Question about this invoice? <Link href={`/customer/support/new?category=BILLING&invoiceId=${inv.id}`} className="font-medium text-brand hover:underline">Ask our billing team</Link>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between ${strong ? "border-t pt-1.5 font-semibold" : "text-muted-foreground"}`}>
      <span>{label}</span>
      <span className="tabular-nums text-foreground">{value}</span>
    </div>
  );
}
