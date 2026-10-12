import { getSetting } from "@/server/services/settings";
import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { ReasonDialog } from "@/components/admin/dialogs";
import { DocLink } from "@/components/portal/doc-link";
import { InvoiceEditor } from "@/components/admin/invoice-editor";
import { AuditTrail } from "@/components/admin/audit-trail";
import { regenerateInvoicePdfAction, sendInvoiceAction, voidInvoiceAction } from "@/app/admin/_actions/billing";
import { formatDateKey, formatInstant, keyFromDate } from "@/lib/dates";
import { formatCents, formatRateCents } from "@/lib/money";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Invoice" };

export default async function AdminInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; edit?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("invoices.read");
  const inv = await prisma.invoice.findUnique({ where: { id }, include: { lineItems: { orderBy: { sortOrder: "asc" } }, organization: { select: { id: true, name: true, accountNumber: true, locations: { where: { deletedAt: null }, select: { id: true, name: true } }, billingProfiles: { select: { id: true, name: true } } } }, serviceLocation: true, billingProfile: true, job: { select: { id: true, jobNumber: true } }, manifest: { select: { id: true, manifestNumber: true } }, documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } }, allocations: { include: { payment: true } } } });
  if (!inv) notFound();
  const tz = await companyTimeZone();
  const canWrite = hasPermission(actor, "invoices.write");
  const open = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"].includes(inv.status);
  const pdf = inv.documents.find((d) => d.type === "INVOICE");
  const editing = inv.status === "DRAFT" && canWrite;
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-2">{inv.invoiceNumber}<StatusBadge kind="invoice" status={inv.status} /></span>}
        description={`${inv.organization.name} · ${inv.serviceLocation?.name ?? "Account level"}`}
        breadcrumbs={[{ label: "Invoices", href: "/admin/invoices" }, { label: inv.invoiceNumber }]}
        actions={
          <>
            {pdf ? <DocLink id={pdf.id}>PDF</DocLink> : <a className="text-[13px] text-brand underline" href={`/api/pdf/invoice/${inv.id}`} target="_blank" rel="noreferrer">Preview PDF</a>}
            <Button asChild variant="ghost" size="sm"><Link href={`/admin/service-reports/new?invoice=${inv.id}`}>Write service report</Link></Button>
            {inv.status === "DRAFT" && canWrite && <ActionButton action={sendInvoiceAction.bind(null, inv.id)} successMessage="Invoice sent to the customer." confirm="Send this invoice to the customer? It can no longer be edited after sending.">Send invoice</ActionButton>}
            {inv.status !== "DRAFT" && canWrite && <ActionButton variant="ghost" size="sm" action={regenerateInvoicePdfAction.bind(null, inv.id)} successMessage="PDF regenerated.">Regenerate PDF</ActionButton>}
            {open && hasPermission(actor, "payments.record") && <Button asChild variant="secondary" size="sm"><Link href={`/admin/payments/new?org=${inv.organizationId}&invoice=${inv.id}`}>Record payment</Link></Button>}
            {hasPermission(actor, "invoices.void") && inv.status !== "VOID" && inv.status !== "WRITTEN_OFF" && inv.amountPaidCents === 0 && <ReasonDialog trigger={{ label: "Void", variant: "danger-outline" }} title="Void invoice" description="Voided invoices stay on record with a zero balance." action={voidInvoiceAction} hidden={{ invoiceId: inv.id, mode: "void" }} submitLabel="Void invoice" submitVariant="danger" />}
            {hasPermission(actor, "invoices.void") && open && <ReasonDialog trigger={{ label: "Write off", variant: "ghost" }} title="Write off remaining balance" action={voidInvoiceAction} hidden={{ invoiceId: inv.id, mode: "write_off" }} submitLabel="Write off" submitVariant="danger" />}
          </>
        }
      />
      {inv.legacySource && <Alert tone="info" title="Imported from your records">Original invoice: {inv.legacySource}. Line items were rebuilt from your records{inv.lineItems.some((l) => /itemized/i.test(l.description)) ? "; extras are itemized on the original" : ""}.</Alert>}
      {inv.manifestRef && <Alert tone="info" title={`Manifest ${inv.manifestRef}`}>Generated with this invoice and filed in the customer&apos;s documents.</Alert>}
      {sp.created && <Alert tone="success" title="Draft created">Review it, then send it to the customer.</Alert>}
      {inv.notes?.startsWith("Pricing required") && <Alert tone="warning" title="Pricing required">No contracted or default price matched this service. Set the price on the line item before sending.</Alert>}
      {editing ? (
        <Card><CardHeader title="Edit draft" /><CardBody>
          <InvoiceEditor orgs={[{ id: inv.organization.id, name: inv.organization.name, locations: inv.organization.locations, billingProfiles: inv.organization.billingProfiles }]} taxRateBps={inv.taxRateBps} manifestFeeBps={(await getSetting("billing")).manifestFeeBps}
            invoice={{ id: inv.id, organizationId: inv.organizationId, serviceLocationId: inv.serviceLocationId, billingProfileId: inv.billingProfileId, serviceDate: inv.serviceDate ? keyFromDate(inv.serviceDate) : null, paymentTermsDays: inv.paymentTermsDays, poNumber: inv.poNumber, serviceTitle: inv.serviceTitle, nextServiceDate: inv.nextServiceDate ? keyFromDate(inv.nextServiceDate) : null, notes: inv.notes, lines: inv.lineItems.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPrice: (Number(l.unitPriceCents) / 100).toFixed(Number(l.unitPriceCents) % 1 ? 4 : 2), taxable: l.taxable })) }} />
        </CardBody></Card>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card>
              <CardBody><DescriptionList columns={3} items={[{ label: "Issued", value: formatDateKey(inv.issueDate, "long") }, { label: "Due", value: formatDateKey(inv.dueDate, "long") }, { label: "Terms", value: `Net ${inv.paymentTermsDays}` }, { label: "Customer", value: <Link href={`/admin/customers/${inv.organizationId}`} className="text-brand hover:underline">{inv.organization.name}</Link> }, { label: "Job", value: inv.job ? <Link href={`/admin/jobs/${inv.job.id}`} className="text-brand hover:underline">{inv.job.jobNumber}</Link> : null }, { label: "Manifest", value: inv.manifest ? <Link href={`/admin/manifests/${inv.manifest.id}`} className="text-brand hover:underline">{inv.manifest.manifestNumber}</Link> : null }, { label: "Billing profile", value: inv.billingProfile?.name }, { label: "Sent", value: inv.sentAt ? formatInstant(inv.sentAt, tz) : "Not sent" }, { label: "Viewed by customer", value: inv.viewedAt ? formatInstant(inv.viewedAt, tz) : "Not yet" }, { label: "Notes", value: inv.notes }, ...(inv.voidReason ? [{ label: "Void reason", value: inv.voidReason }] : [])]} /></CardBody>
            </Card>
            <Card>
              <Table>
                <THead><tr><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit</TH><TH className="text-right">Amount</TH></tr></THead>
                <TBody>{inv.lineItems.map((l) => <TR key={l.id}><TD>{l.description}{!l.taxable && <span className="ml-2 text-[11px] text-muted-foreground">non-taxable</span>}</TD><TD className="text-right tabular-nums">{Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 })}</TD><TD className="text-right tabular-nums">{formatRateCents(l.unitPriceCents.toString())}</TD><TD className="text-right tabular-nums">{formatCents(l.amountCents)}</TD></TR>)}</TBody>
              </Table>
              <div className="ml-auto max-w-xs space-y-1.5 px-5 py-4 text-sm">
                {[["Subtotal", formatCents(inv.subtotalCents)], ...(inv.discountCents ? [["Discounts", `−${formatCents(inv.discountCents)}`]] : []), [`Tax (${(inv.taxRateBps / 100).toFixed(2)}%)`, formatCents(inv.taxCents)], ["Total", formatCents(inv.totalCents)], ["Paid", `−${formatCents(inv.amountPaidCents)}`], ["Balance", formatCents(inv.balanceCents)]].map(([l, v]) => <div key={l} className={`flex justify-between ${l === "Total" || l === "Balance" ? "font-semibold" : "text-muted-foreground"}`}><span>{l}</span><span className="tabular-nums text-foreground">{v}</span></div>)}
              </div>
            </Card>
          </div>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Payments" />
              <CardBody className="space-y-2 text-[13px]">
                {inv.allocations.length === 0 && <p className="text-muted-foreground">No payments.</p>}
                {inv.allocations.map((a) => <Link key={a.id} href={`/admin/payments/${a.paymentId}`} className="flex items-center justify-between gap-2 hover:text-brand"><span>{a.payment.paymentNumber} · {a.payment.method.toLowerCase()}<span className="block text-muted-foreground">{formatInstant(a.payment.receivedAt ?? a.payment.createdAt, tz, "date")}{a.applied ? "" : " · not yet applied"}</span></span><span className="text-right tabular-nums">{formatCents(a.amountCents)}<StatusBadge kind="payment" status={a.payment.status} /></span></Link>)}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Documents" />
              <CardBody className="space-y-2 text-[13px]">{inv.documents.map((d) => <div key={d.id} className="flex justify-between"><span>{d.title}</span><DocLink id={d.id} /></div>)}</CardBody>
            </Card>
          </div>
        </div>
      )}
      {hasPermission(actor, "audit.read") && <AuditTrail where={{ entityType: "Invoice", entityId: inv.id }} title="Invoice audit trail" />}
    </div>
  );
}
