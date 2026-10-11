import "server-only";
import type { Db } from "../db";
import { PdfWriter, colors } from "./layout";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { formatCents, formatRateCents } from "@/lib/money";
import { formatAddress } from "@/lib/utils";
import { companyTimeZone, getSetting } from "../services/settings";

export async function renderInvoicePdf(db: Db, invoiceId: string): Promise<Uint8Array> {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, organization: true, billingProfile: true, serviceLocation: true, job: { select: { jobNumber: true } }, manifest: { select: { manifestNumber: true } } },
  });
  const company = await getSetting("company", db);
  const billing = await getSetting("billing", db);
  const w = await PdfWriter.create(`Invoice ${inv.invoiceNumber}`, `${company.name} · Invoice ${inv.invoiceNumber} · Questions? ${company.phone || company.email || "Contact your account representative"}`);
  w.header("Invoice", [company.addressLine1, [company.city, company.state, company.postalCode].filter(Boolean).join(" "), company.phone, company.email].filter(Boolean).join(" · ") || company.name, [
    inv.invoiceNumber,
    `Issued ${formatDateKey(inv.issueDate, "long")}`,
    `Due ${formatDateKey(inv.dueDate, "long")}`,
    `Terms: Net ${inv.paymentTermsDays}`,
  ]);
  if (inv.status === "VOID") w.stamp("VOID");
  if (inv.status === "DRAFT") w.stamp("DRAFT");

  const bp = inv.billingProfile;
  w.fields([
    ["Bill to", [bp?.name ?? inv.organization.name, bp?.addressLine1, [bp?.city, bp?.state, bp?.postalCode].filter(Boolean).join(" "), bp?.billingEmail].filter(Boolean).join("\n")],
    ["Service location", inv.serviceLocation ? `${inv.serviceLocation.name}\n${formatAddress(inv.serviceLocation)}` : "Multiple / account level"],
    ["Customer account", `${inv.organization.name} (${inv.organization.accountNumber})`],
    ["Reference", [inv.serviceDate ? `Service date ${formatDateKey(inv.serviceDate)}` : null, inv.job ? `Job ${inv.job.jobNumber}` : null, inv.manifest ? `Manifest ${inv.manifest.manifestNumber}` : null, inv.poNumber ? `PO ${inv.poNumber}` : null].filter(Boolean).join("\n")],
  ]);
  w.y -= 4;
  w.table(
    ["Description", "Qty", "Unit price", "Amount"],
    inv.lineItems.map((l) => [l.description, Number(l.quantity).toLocaleString("en-US", { maximumFractionDigits: 3 }), formatRateCents(l.unitPriceCents.toString()), formatCents(l.amountCents)]),
    [5, 1, 1.4, 1.4],
    ["left", "right", "right", "right"],
  );
  const rows: [string, string, boolean?][] = [["Subtotal", formatCents(inv.subtotalCents)]];
  if (inv.discountCents) rows.push(["Discounts", `-${formatCents(inv.discountCents)}`]);
  rows.push([`Tax (${(inv.taxRateBps / 100).toFixed(2)}%)`, formatCents(inv.taxCents)]);
  rows.push(["Total", formatCents(inv.totalCents), true]);
  if (inv.amountPaidCents) rows.push(["Paid", `-${formatCents(inv.amountPaidCents)}`]);
  rows.push(["Balance due", formatCents(inv.balanceCents), true]);
  w.totals(rows);
  w.y -= 10;
  if (inv.notes) w.text(inv.notes, { size: 8.5, color: colors.muted, gap: 6 });
  w.text("Pay online securely from your Sewer Squad customer portal. Card and bank payments are processed by Stripe; Sewer Squad never stores card numbers.", { size: 8.5, color: colors.muted, gap: 4 });
  if (billing.invoiceFooter) w.text(billing.invoiceFooter, { size: 8.5, color: colors.muted });
  return w.save();
}

export async function renderReceiptPdf(db: Db, paymentId: string): Promise<Uint8Array> {
  const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { organization: true, allocations: { include: { invoice: true } }, refunds: { where: { status: "SUCCEEDED" } } } });
  const company = await getSetting("company", db);
  const tz = await companyTimeZone(db);
  const w = await PdfWriter.create(`Receipt ${p.paymentNumber}`, `${company.name} · Payment receipt ${p.paymentNumber}`);
  w.header("Payment Receipt", company.name, [p.paymentNumber, `Received ${formatInstant(p.receivedAt ?? p.createdAt, tz)}`, `Method: ${p.method === "CARD" ? "Card" : p.method === "ACH" ? "Bank (ACH)" : p.method.toLowerCase()}`]);
  w.fields([
    ["Customer", `${p.organization.name} (${p.organization.accountNumber})`],
    ["Amount received", formatCents(p.amountCents)],
    ["Status", p.status.replace(/_/g, " ").toLowerCase()],
    ["Reference", p.reference ?? p.stripePaymentIntentId ?? "—"],
  ]);
  w.table(
    ["Invoice", "Invoice total", "Applied"],
    p.allocations.map((a) => [a.invoice.invoiceNumber, formatCents(a.invoice.totalCents), formatCents(a.amountCents)]),
    [3, 1.5, 1.5],
    ["left", "right", "right"],
  );
  if (p.refunds.length) w.totals([["Refunded", `-${formatCents(p.refunds.reduce((s, r) => s + r.amountCents, 0))}`]]);
  w.text("Thank you for your payment.", { size: 9, color: colors.muted });
  return w.save();
}
