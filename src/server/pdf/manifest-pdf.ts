import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import type { Db } from "../db";
import { storage } from "../storage";
import { pdfSafe } from "./layout";
import { ink } from "./branded";
import { LOGO_STACKED_PNG_BASE64, LOGO_STACKED_SIZE } from "./logo-data";
import type { ManifestData } from "../services/manifests";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { companyTimeZone, getSetting } from "../services/settings";

/**
 * Sewer Squad's Non-Hazardous Waste Control Manifest, laid out like the owner's form
 * (Sewer_Squad_Waste_Manifest.docx): transporter, generator, waste source, certifications and
 * disposal site, filled from the job's records. Blank fields stay blank — nothing is invented.
 */
const W = 612;
const H = 792;
const L = 36;
const R = 576;
const BORDER = rgb(0.62, 0.67, 0.74);
const SOFT = rgb(0.957, 0.965, 0.976);

export type ManifestSignature = { name: string | null; at: string | null; imageKey: string | null; note?: string | null };
export type ManifestRender = {
  data: ManifestData;
  customerSignature: ManifestSignature | null;
  driverSignature: ManifestSignature | null;
  draft: boolean;
  integrity?: string;
};

class Form {
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  italic!: PDFFont;
  doc!: PDFDocument;

  spaced(text: string, x: number, y: number, size: number, font: PDFFont, color: RGB, spacing: number, align: "left" | "right" = "left") {
    const t = pdfSafe(text);
    const width = [...t].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + spacing, -spacing);
    let cx = align === "right" ? x - width : x;
    for (const ch of t) {
      this.page.drawText(ch, { x: cx, y, size, font, color });
      cx += font.widthOfTextAtSize(ch, size) + spacing;
    }
  }

  fit(text: string, size: number, maxW: number, font: PDFFont) {
    let t = pdfSafe(text);
    while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -2) + "…";
    return t;
  }

  /** Navy section bar with the green accent on the left. */
  bar(title: string, top: number) {
    this.page.drawRectangle({ x: L, y: top - 14.4, width: R - L, height: 14.4, color: ink.navy });
    this.page.drawRectangle({ x: L, y: top - 14.4, width: 4, height: 14.4, color: ink.green });
    this.spaced(title, L + 13, top - 10, 7, this.bold, ink.white, 1.6);
  }

  /** One row of labelled boxes. `xs` are the internal column edges. */
  row(top: number, h: number, xs: number[], cells: { label: string; value?: string | null; bold?: boolean }[]) {
    const edges = [L, ...xs, R];
    this.page.drawRectangle({ x: L, y: top - h, width: R - L, height: h, borderColor: BORDER, borderWidth: 0.6 });
    for (const x of xs) this.page.drawLine({ start: { x, y: top }, end: { x, y: top - h }, thickness: 0.6, color: BORDER });
    cells.forEach((c, i) => {
      const x = edges[i]! + 6;
      const w = edges[i + 1]! - edges[i]! - 12;
      this.spaced(c.label, x, top - 9, 5.6, this.bold, ink.muted, 0.9);
      if (c.value) this.page.drawText(this.fit(c.value, 9, w, c.bold === false ? this.font : this.bold), { x, y: top - h + 6.5, size: 9, font: c.bold === false ? this.font : this.bold, color: ink.navy });
    });
  }
}

const SOURCES = ["Grease Trap", "Grit Trap", "Septic Tank", "Lift Station", "Chemical Toilet", "Domestic Holding Tank", "Sewer / Drain Line"] as const;

/** Which "waste removed from" boxes to tick, from the equipment serviced. */
export function wasteSources(equipment: { type: string }[]): { checked: Set<string>; other: string | null } {
  const checked = new Set<string>();
  const other: string[] = [];
  for (const e of equipment) {
    const t = e.type.toLowerCase();
    if (t.includes("grease")) checked.add("Grease Trap");
    else if (t.includes("grit")) checked.add("Grit Trap");
    else if (t.includes("septic")) checked.add("Septic Tank");
    else if (t.includes("lift")) checked.add("Lift Station");
    else if (t.includes("toilet")) checked.add("Chemical Toilet");
    else if (t.includes("holding")) checked.add("Domestic Holding Tank");
    else if (t.includes("line") || t.includes("drain") || t.includes("sewer")) checked.add("Sewer / Drain Line");
    else other.push(e.type);
  }
  return { checked, other: other.length ? [...new Set(other)].join(", ") : null };
}

async function signatureImage(f: Form, key: string | null, x: number, y: number, maxW: number, maxH: number) {
  if (!key) return;
  try {
    const bytes = await storage().get(key);
    const img = bytes[0] === 0x89 ? await f.doc.embedPng(bytes) : await f.doc.embedJpg(bytes);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    f.page.drawImage(img, { x, y, width: img.width * scale, height: img.height * scale });
  } catch {
    /* missing or unreadable image: leave the box empty rather than fabricate */
  }
}

export async function drawManifest(db: Db, r: ManifestRender): Promise<Uint8Array> {
  const d = r.data;
  const [tz, company, hauler] = await Promise.all([companyTimeZone(db), getSetting("company", db), getSetting("hauler", db)]);
  const f = new Form();
  f.doc = await PDFDocument.create();
  f.doc.setTitle(pdfSafe(`Manifest ${d.reference.manifestNumber}`));
  f.doc.setCreator(pdfSafe(hauler.legalName || company.name));
  f.font = await f.doc.embedFont(StandardFonts.Helvetica);
  f.bold = await f.doc.embedFont(StandardFonts.HelveticaBold);
  f.italic = await f.doc.embedFont(StandardFonts.HelveticaOblique);
  f.page = f.doc.addPage([W, H]);
  const p = f.page;
  const time = (iso: string | null | undefined) => (iso ? formatInstant(iso, tz) : null);
  const dateOnly = (iso: string | null | undefined) => (iso ? formatInstant(iso, tz).replace(/,? \d{1,2}:\d{2}.*$/, "") : null);

  // Header: logo, title, reference boxes.
  const logo = await f.doc.embedPng(Buffer.from(LOGO_STACKED_PNG_BASE64, "base64"));
  const logoH = 74;
  p.drawImage(logo, { x: L, y: H - 22 - logoH, width: (LOGO_STACKED_SIZE.width / LOGO_STACKED_SIZE.height) * logoH, height: logoH });
  f.spaced("NON-HAZARDOUS WASTE", R, H - 32, 13.5, f.bold, ink.navy, 1.1, "right");
  f.spaced("CONTROL MANIFEST", R, H - 45, 13.5, f.bold, ink.navy, 1.1, "right");
  f.spaced("TRANSPORT  •  DISPOSAL  •  RECORD OF SERVICE", R, H - 58, 6.3, f.bold, ink.green, 1.3, "right");
  if (r.draft) f.spaced("DRAFT — NOT FINALIZED", R, H - 14, 8, f.bold, ink.danger, 1, "right");
  const refTop = H - 64;
  p.drawRectangle({ x: 216, y: refTop - 29, width: R - 216, height: 29, borderColor: BORDER, borderWidth: 0.6 });
  p.drawLine({ start: { x: 394, y: refTop }, end: { x: 394, y: refTop - 29 }, thickness: 0.6, color: BORDER });
  f.spaced("MANIFEST / TICKET NO.", 222, refTop - 9, 5.6, f.bold, ink.muted, 0.9);
  f.spaced("DATE OF PICK-UP", 400, refTop - 9, 5.6, f.bold, ink.muted, 0.9);
  p.drawText(pdfSafe(d.reference.manifestNumber), { x: 222, y: refTop - 23, size: 10, font: f.bold, color: ink.navy });
  p.drawText(pdfSafe(formatDateKey(d.reference.serviceDate, "long")), { x: 400, y: refTop - 23, size: 10, font: f.bold, color: ink.navy });

  // Transporter.
  let y = 683;
  f.bar("TRANSPORTER INFORMATION", y);
  y -= 28;
  const tceq = d.hauler.tceqNumber ?? (hauler.tceqNumber || null);
  f.row(y, 28.8, [306], [{ label: "NAME OF TRANSPORTER", value: d.hauler.name }, { label: "TCEQ REGISTRATION NO.", value: tceq }]);
  y -= 28.8;
  f.row(y, 28.8, [306, 441], [
    { label: "TRANSPORTER ADDRESS", value: d.hauler.address ?? ([company.addressLine1, [company.city, company.state].filter(Boolean).join(", ")].filter(Boolean).join(", ") || null) },
    { label: "PHONE NO.", value: d.hauler.phone ?? (company.phone || null) },
    { label: "DRIVER NAME", value: d.hauler.driverName },
  ]);

  // Generator / customer.
  y -= 43;
  f.bar("GENERATOR / CUSTOMER INFORMATION  —  ONE TICKET PER LOCATION", y);
  y -= 28;
  const capacity = d.collection.equipment.reduce((s, e) => s + e.capacityGallons, 0);
  f.row(y, 28.8, [396], [{ label: "CUSTOMER / BUSINESS NAME", value: d.generator.businessName }, { label: "ZIP CODE", value: d.generator.postalCode ?? null }]);
  y -= 28.8;
  f.row(y, 28.8, [396], [{ label: "SERVICE ADDRESS (CITY / COUNTY)", value: [d.generator.address, d.generator.county ? `${d.generator.county} County` : null].filter(Boolean).join(" · ") }, { label: "PHONE NO.", value: d.generator.contactPhone }]);
  y -= 28.8;
  f.row(y, 28.8, [216, 396], [
    { label: "CAPACITY OF TANK / TRAP (GAL)", value: capacity > 0 ? capacity.toLocaleString() : null },
    { label: "QUANTITY OF WASTE REMOVED (GAL)", value: d.collection.totalGallons > 0 ? d.collection.totalGallons.toLocaleString() : null },
    { label: "TIME OF PICK-UP", value: time(d.collection.finishedAt ?? d.collection.startedAt) },
  ]);

  // Waste removed from.
  y -= 43;
  f.bar("WASTE REMOVED FROM", y);
  y -= 28;
  const src = wasteSources(d.collection.equipment);
  p.drawRectangle({ x: L, y: y - 33.6, width: R - L, height: 33.6, borderColor: BORDER, borderWidth: 0.6 });
  const cols = [47, 176, 305, 433];
  const items: string[] = [...SOURCES, "Other"];
  items.forEach((label, i) => {
    const x = cols[i % 4]!;
    const by = y - 13.5 - Math.floor(i / 4) * 15;
    p.drawRectangle({ x, y: by - 1.5, width: 8.5, height: 8.5, borderColor: ink.navy, borderWidth: 0.7 });
    const on = label === "Other" ? !!src.other : src.checked.has(label);
    if (on) {
      p.drawLine({ start: { x: x + 1.6, y: by + 3 }, end: { x: x + 3.6, y: by + 0.6 }, thickness: 1.3, color: ink.green });
      p.drawLine({ start: { x: x + 3.6, y: by + 0.6 }, end: { x: x + 7.4, y: by + 6.2 }, thickness: 1.3, color: ink.green });
    }
    const text = label === "Other" ? `Other: ${src.other ?? "__________"}` : label;
    p.drawText(f.fit(text, 9, 110, f.font), { x: x + 14, y: by, size: 9, font: f.font, color: ink.cell });
  });

  // Customer certification.
  y -= 33.6 + 13.4;
  const cs = r.customerSignature;
  p.drawRectangle({ x: L, y: y - 29.6, width: 266 - L, height: 29.6, color: SOFT });
  f.row(y, 29.6, [266, 476], [{ label: "" }, { label: "CUSTOMER / AGENT SIGNATURE", value: null }, { label: "DATE", value: dateOnly(cs?.at), bold: false }]);
  p.drawText("I hereby certify that the waste is as described above.", { x: L + 7, y: y - 18, size: 7.5, font: f.italic, color: ink.body });
  if (cs?.imageKey) await signatureImage(f, cs.imageKey, 272, y - 28, 110, 19);
  if (cs?.name || cs?.note) p.drawText(f.fit(cs.note ?? cs.name ?? "", 7, 92, f.font), { x: 384, y: y - 26, size: 7, font: f.font, color: ink.muted });

  // Transporter certification.
  y -= 29.6 + 14.4;
  f.bar("TRANSPORTER CERTIFICATION", y);
  y -= 14.4 + 13.6;
  const cert =
    "I certify to the best of my knowledge that this load contains no chemical or hazardous waste material. I am aware that falsification of this ticket may result in forfeiture of my transporter's registration and/or the privilege of utilizing state permitted disposal facilities. I also understand that falsification of these type records is a felony offense in the State of Texas and may result in revocation of my waste transportation permit, criminal prosecution and/or civil penalties of up to $25,000 per violation.";
  const lines = wrap(f, cert, 7, R - L - 22);
  const boxH = lines.length * 9.6 + 9;
  p.drawRectangle({ x: L, y: y - boxH, width: R - L, height: boxH, color: SOFT });
  p.drawRectangle({ x: L, y: y - boxH, width: 2, height: boxH, color: ink.green });
  lines.forEach((l, i) => p.drawText(l, { x: L + 11, y: y - 10.5 - i * 9.6, size: 7, font: f.italic, color: ink.body }));
  y -= boxH + 14;
  const ds = r.driverSignature;
  f.row(y, 28.8, [396], [{ label: "TRUCK DRIVER'S SIGNATURE" }, { label: "DATE", value: dateOnly(ds?.at), bold: false }]);
  if (ds?.imageKey) await signatureImage(f, ds.imageKey, L + 6, y - 27, 120, 17);
  if (ds?.name) p.drawText(f.fit(ds.name, 7.5, 200, f.font), { x: L + 140, y: y - 23, size: 7.5, font: f.font, color: ink.muted });

  // Disposal site.
  y -= 28.8 + 14.4;
  f.bar("DISPOSAL SITE INFORMATION", y);
  y -= 28;
  f.row(y, 28.8, [306, 441], [
    { label: "DISPOSAL SITE NAME", value: d.disposal.facilityName },
    { label: "TCEQ PERMIT NO.", value: d.disposal.facilityPermit },
    { label: "GALLONS RECEIVED", value: d.disposal.gallonsReceived ? d.disposal.gallonsReceived.toLocaleString() : null },
  ]);
  y -= 28.8;
  f.row(y, 28.8, [306, 441], [
    { label: "DISPOSAL SITE ADDRESS", value: d.disposal.facilityAddress, bold: false },
    { label: "TIME / DATE RECEIVED", value: time(d.disposal.disposedAt), bold: false },
    { label: "FACILITY REP. SIGNATURE", value: d.disposal.facilityAcknowledged ? `On ticket${d.disposal.ticketNumber ? ` #${d.disposal.ticketNumber}` : ""}` : null, bold: false },
  ]);

  // Footer.
  p.drawLine({ start: { x: L, y: 45 }, end: { x: R, y: 45 }, thickness: 1.2, color: ink.green });
  const permits = [tceq && `TCEQ #${tceq}`, hauler.cityOfHoustonNumber && `COH FOG #${hauler.cityOfHoustonNumber}`].filter(Boolean);
  const rest = [[company.addressLine1, [company.city, company.state].filter(Boolean).join(", ")].filter(Boolean).join(", "), company.phone, company.email, ...permits].filter(Boolean).join("   •   ");
  const name = "SEWER SQUAD";
  const nameW = [...name].reduce((w, ch) => w + f.bold.widthOfTextAtSize(ch, 7.5) + 1.8, 0);
  const restT = pdfSafe(`   •   ${rest}`);
  const total = nameW + f.font.widthOfTextAtSize(restT, 6.5);
  const x0 = W / 2 - total / 2;
  f.spaced(name, x0, 29, 7.5, f.bold, ink.navy, 1.8);
  p.drawText(restT, { x: x0 + nameW, y: 29, size: 6.5, font: f.font, color: ink.muted });
  const copies = "White Copy – Customer      Yellow Copy – Office File      Pink Copy – Truck Driver";
  p.drawText(pdfSafe(copies), { x: W / 2 - f.italic.widthOfTextAtSize(pdfSafe(copies), 6) / 2, y: 17, size: 6, font: f.italic, color: ink.muted });
  if (r.integrity) p.drawText(pdfSafe(r.integrity), { x: R - f.font.widthOfTextAtSize(pdfSafe(r.integrity), 5), y: 8, size: 5, font: f.font, color: BORDER });
  return f.doc.save();
}

function wrap(f: Form, text: string, size: number, maxW: number) {
  const out: string[] = [];
  let line = "";
  for (const word of pdfSafe(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (f.italic.widthOfTextAtSize(next, size) > maxW && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** Render a manifest version (immutable snapshot) to PDF. */
export async function renderManifestPdf(db: Db, manifestId: string, version: number): Promise<Uint8Array> {
  const v = await db.manifestVersion.findUniqueOrThrow({ where: { manifestId_version: { manifestId, version } }, include: { manifest: { include: { signatures: true } } } });
  const data = v.data as unknown as ManifestData;
  const latest = async (role: "CUSTOMER" | "DRIVER") => {
    const s = v.manifest.signatures.filter((x) => x.role === role).sort((a, b) => b.signedAt.getTime() - a.signedAt.getTime())[0];
    if (!s) return null;
    const ver = s.signatureDocumentId ? await db.documentVersion.findFirst({ where: { documentId: s.signatureDocumentId }, orderBy: { version: "desc" } }) : null;
    return { name: s.signerName || null, at: s.signedAt.toISOString(), imageKey: ver?.storageKey ?? null, note: s.unavailable ? `Unavailable: ${s.unavailableReason ?? ""}` : s.signerName || null };
  };
  return drawManifest(db, {
    data,
    customerSignature: await latest("CUSTOMER"),
    driverSignature: await latest("DRIVER"),
    draft: !v.isFinal,
    integrity: `Manifest ${data.reference.manifestNumber} · v${v.version} · SHA-256 ${v.contentHash.slice(0, 16)}`,
  });
}
