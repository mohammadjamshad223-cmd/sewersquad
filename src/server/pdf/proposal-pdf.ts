import "server-only";
import type { Db } from "../db";
import { BrandedPdf, companyBlock, companyLine, fitPages, ink } from "./branded";
import { lineRow, type DocLine } from "@/domain/document-lines";
import { formatDateKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { getSetting } from "../services/settings";

export async function renderProposalPdf(db: Db, proposalId: string): Promise<Uint8Array> {
  const p = await db.proposal.findUniqueOrThrow({ where: { id: proposalId }, include: { sections: { orderBy: { sortOrder: "asc" }, include: { lines: { orderBy: { sortOrder: "asc" } } } } } });
  const [company, billing] = await Promise.all([companyBlock(db), getSetting("billing", db)]);
  const word = p.kind === "QUOTE" ? "Quote" : "Proposal";
  return fitPages(async (k) => {
    const w = await BrandedPdf.create(`${word} ${p.number}`, company, k);
    w.setFooter(["Thank you for the opportunity to earn your business!", companyLine(company)]);
    const stamp = p.status === "ACCEPTED" ? { text: "ACCEPTED", color: ink.green } : p.status === "DECLINED" ? { text: "DECLINED", color: ink.muted } : p.status === "DRAFT" ? { text: "DRAFT", color: ink.muted } : undefined;
    w.header(word.toUpperCase(), [{ text: `${word} #: ${p.number}` }, { text: `Date: ${formatDateKey(p.date, "long")}` }], company, stamp);
    w.columns([
      [{ label: "PREPARED FOR", name: p.preparedFor.toUpperCase(), lines: [p.addressLine1, `${p.city}, ${p.state}${p.postalCode ? ` ${p.postalCode}` : ""}`] }],
      [{ label: "SCOPE", lines: [p.scopeTitle, ...(p.scopeSubtitle ? [p.scopeSubtitle] : [])] }],
    ]);
    if (p.intro) w.paragraph(p.intro, { gap: 12 });

    for (const s of p.sections) {
      if (s.title) {
        w.subheading(s.title);
        w.y -= 4;
      }
      const lines: DocLine[] = s.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPriceCents: l.unitPriceCents.toString(), amountCents: l.amountCents }));
      if (lines.length) w.table(lines.map((l) => lineRow(l, billing.manifestFeeBps, "service")));
      if (s.subtotalLabel) {
        w.y += 2;
        w.summary([{ label: `${s.subtotalLabel}:`, value: formatCents(lines.reduce((t, l) => t + l.amountCents, 0)), bold: true }]);
        w.y -= 2;
      }
    }
    w.totalBar(`${word.toUpperCase()} ${p.priceNote ? "ESTIMATE" : "TOTAL"}:`, p.priceNote ?? formatCents(p.totalCents));
    if (p.note) w.note(p.note.split("\n"));
    const contact = [company.phone && `call ${company.phone}`, company.email && `email ${company.email}`].filter(Boolean).join(" or ");
    if (contact) w.italicLine(`To approve this ${word.toLowerCase()} or schedule service, ${contact}.`);
    return w;
  });
}
