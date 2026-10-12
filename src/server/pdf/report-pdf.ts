import "server-only";
import type { Db } from "../db";
import { BrandedPdf, companyBlock, companyLine, fitPages, ink } from "./branded";
import { formatDateKey } from "@/lib/dates";
import { reportSections } from "../services/service-reports";

export async function renderReportPdf(db: Db, reportId: string): Promise<Uint8Array> {
  const r = await db.serviceReport.findUniqueOrThrow({ where: { id: reportId } });
  const company = await companyBlock(db);
  return fitPages(async (k) => {
    const w = await BrandedPdf.create(`Service Report ${r.number}`, company, k);
    w.setFooter([`Prepared by ${company.legalName}`, companyLine(company, false)]);
    w.header("SERVICE REPORT", [{ text: `Report #: ${r.number}` }, { text: `Date: ${formatDateKey(r.serviceDate, "long")}` }], company, r.status === "DRAFT" ? { text: "DRAFT", color: ink.muted } : undefined);
    w.columns([
      [{ label: "PREPARED FOR", name: r.preparedFor.toUpperCase(), lines: [r.addressLine1, `${r.city}, ${r.state}${r.postalCode ? ` ${r.postalCode}` : ""}`] }],
      [
        { label: "SERVICE DATE", lines: [formatDateKey(r.serviceDate, "long")] },
        { label: "SUBJECT", lines: [r.subject] },
      ],
    ]);
    w.y += 6;
    for (const s of reportSections(r.sections)) {
      w.sectionTitle(s.title);
      w.richText(s.body);
      w.y -= 3;
    }
    if (r.closing) w.italicLine(r.closing);
    return w;
  });
}
