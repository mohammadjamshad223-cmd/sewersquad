import "server-only";
import type { Db } from "../db";
import { PdfWriter, colors } from "./layout";
import { BrandedPdf, companyBlock, companyLine, fitPages, ink } from "./branded";
import { autoNote, lineRow, summaryLabel, type DocLine } from "@/domain/document-lines";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { companyTimeZone, getSetting } from "../services/settings";

export async function renderInvoicePdf(db: Db, invoiceId: string): Promise<Uint8Array> {
  const inv = await db.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    include: { lineItems: { orderBy: { sortOrder: "asc" } }, organization: true, billingProfile: true, serviceLocation: true, job: { select: { jobNumber: true } }, manifest: { select: { manifestNumber: true } } },
  });
  const [company, billing] = await Promise.all([companyBlock(db), getSetting("billing", db)]);
  const bps = billing.manifestFeeBps;
  return fitPages(async (k) => {
    const w = await BrandedPdf.create(`Invoice ${inv.invoiceNumber}`, company, k);
    w.setFooter([billing.invoiceFooter, companyLine(company)]);

    const stamp = inv.status === "VOID" ? { text: "VOID", color: ink.danger } : inv.status === "DRAFT" ? { text: "DRAFT", color: ink.muted } : inv.status === "PAID" ? { text: "PAID", color: ink.green } : inv.status === "WRITTEN_OFF" ? { text: "WRITTEN OFF", color: ink.muted } : undefined;
    w.header(
      "INVOICE",
      [
        { text: `Invoice #: ${inv.invoiceNumber}` },
        { text: `Date: ${formatDateKey(inv.issueDate, "long")}` },
        ...(inv.paymentTermsDays > 0 ? [{ text: `Due: ${formatDateKey(inv.dueDate, "long")}` }] : []),
        ...(inv.nextServiceDate ? [{ text: `NEXT SERVICE DATE: ${formatDateKey(inv.nextServiceDate, "long")}`, strong: true }] : []),
      ],
      company,
      stamp,
    );

    const bp = inv.billingProfile;
    const loc = inv.serviceLocation;
    const billName = (loc?.name ?? inv.organization.name).toUpperCase();
    const billLines = bp?.addressLine1 ? [bp.addressLine1, [bp.city, bp.state].filter(Boolean).join(", ") + (bp.postalCode ? ` ${bp.postalCode}` : "")] : loc ? [loc.addressLine1, `${loc.city}, ${loc.state}${loc.postalCode ? ` ${loc.postalCode}` : ""}`] : [];
    const serviceLines = [
      inv.serviceTitle ?? inv.lineItems[0]?.description ?? "Service",
      ...(inv.serviceDate ? [`Service date: ${formatDateKey(inv.serviceDate, "long")}`] : []),
      ...(inv.manifest ? [`Manifest: ${inv.manifest.manifestNumber}`] : []),
      ...(inv.poNumber ? [`PO: ${inv.poNumber}`] : []),
    ];
    w.columns([[{ label: "BILL TO", name: billName, lines: billLines }], [{ label: "SERVICE", lines: serviceLines }]]);

    const lines: DocLine[] = inv.lineItems.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPriceCents: l.unitPriceCents.toString(), amountCents: l.amountCents }));
    w.table(lines.map((l) => lineRow(l, bps)));

    const rows: { label: string; value: string }[] = [];
    if (lines.length <= 5) for (const l of lines) rows.push({ label: `${summaryLabel(l, bps)}:`, value: l.amountCents < 0 ? `-${formatCents(-l.amountCents)}` : formatCents(l.amountCents) });
    else rows.push({ label: "Subtotal:", value: formatCents(inv.subtotalCents - inv.discountCents) });
    if (inv.taxCents) rows.push({ label: `Sales tax (${(inv.taxRateBps / 100).toFixed(2)}%):`, value: formatCents(inv.taxCents) });
    if (inv.amountPaidCents) rows.push({ label: "Invoice total:", value: formatCents(inv.totalCents) }, { label: "Paid:", value: `-${formatCents(inv.amountPaidCents)}` });
    w.y -= 12;
    w.summary(rows);
    w.totalBar(inv.status === "PAID" ? "PAID IN FULL:" : "TOTAL DUE:", formatCents(inv.status === "VOID" ? 0 : inv.balanceCents));

    const note = inv.notes ? inv.notes.split("\n") : autoNote(lines, bps);
    const closing = inv.status === "PAID" ? "Paid in full. Thank you!" : billing.invoiceNote;
    w.note([...note, closing && !note.join(" ").includes(closing) ? closing : ""]);
    const app = (process.env.APP_URL ?? "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (app && !["PAID", "VOID", "WRITTEN_OFF", "DRAFT"].includes(inv.status)) w.italicLine(`Pay online anytime at ${app}, or call ${company.phone || "our office"}.`);
    return w;
  });
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
