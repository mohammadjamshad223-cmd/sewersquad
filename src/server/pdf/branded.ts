import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import type { Db } from "../db";
import { getSetting } from "../services/settings";
import { pdfSafe } from "./layout";
import { LOGO_STACKED_PNG_BASE64, LOGO_STACKED_SIZE } from "./logo-data";

/**
 * Sewer Squad's own document style (invoices, proposals, service reports), measured from the
 * owner's templates: stacked logo, navy title, green rules, navy table header, green total bar.
 */
const W = 612;
const H = 792;
const L = 46.8;
const R = 565.2;
const BOTTOM = 66; // keep clear of the footer

export const ink = {
  navy: rgb(0.105882, 0.227451, 0.360784),
  green: rgb(0.423529, 0.701961, 0.247059),
  muted: rgb(0.419608, 0.447059, 0.501961),
  body: rgb(0.215686, 0.254902, 0.317647),
  cell: rgb(0.121569, 0.160784, 0.215686),
  rowAlt: rgb(0.94902, 0.960784, 0.972549),
  border: rgb(0.819608, 0.835294, 0.858824),
  white: rgb(1, 1, 1),
  danger: rgb(0.75, 0.1, 0.1),
};

export type CompanyBlock = { legalName: string; address: string; phone: string; email: string; permits: string };

/** Company details as printed on every document. Blank values are left out, never invented. */
export async function companyBlock(db: Db): Promise<CompanyBlock> {
  const [c, h] = await Promise.all([getSetting("company", db), getSetting("hauler", db)]);
  const cityState = [c.city, c.state].filter(Boolean).join(", ");
  return {
    legalName: h.legalName || c.name,
    address: [c.addressLine1, cityState].filter(Boolean).join(", ") + (c.postalCode ? ` ${c.postalCode}` : ""),
    phone: c.phone,
    email: c.email,
    permits: [h.tceqNumber && `TCEQ #${h.tceqNumber}`, h.cityOfHoustonNumber && `City of Houston #${h.cityOfHoustonNumber}`].filter(Boolean).join("  |  "),
  };
}

export type TableRow = { description: string; qty: string; rate: string; amount: string };

export class BrandedPdf {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  italic!: PDFFont;
  private logo!: PDFImage;
  private footerLines: string[] = [];
  y = H;
  /** Vertical spacing factor (< 1 tightens line and block spacing, never font sizes). */
  k = 1;

  static async create(title: string, company: CompanyBlock, k = 1) {
    const p = new BrandedPdf();
    p.k = k;
    p.doc = await PDFDocument.create();
    p.doc.setTitle(pdfSafe(title));
    p.doc.setAuthor(pdfSafe(company.legalName));
    p.doc.setCreator(pdfSafe(company.legalName));
    p.font = await p.doc.embedFont(StandardFonts.Helvetica);
    p.bold = await p.doc.embedFont(StandardFonts.HelveticaBold);
    p.italic = await p.doc.embedFont(StandardFonts.HelveticaOblique);
    p.logo = await p.doc.embedPng(Buffer.from(LOGO_STACKED_PNG_BASE64, "base64"));
    p.page = p.doc.addPage([W, H]);
    return p;
  }

  /** Footer text drawn on every page: first line centered, then the company line. */
  setFooter(lines: string[]) {
    this.footerLines = lines.filter(Boolean);
  }

  private draw(text: string, x: number, y: number, size: number, font: PDFFont, color: RGB) {
    this.page.drawText(pdfSafe(text), { x, y, size, font, color });
  }
  private right(text: string, xRight: number, y: number, size: number, font: PDFFont, color: RGB) {
    const t = pdfSafe(text);
    this.page.drawText(t, { x: xRight - font.widthOfTextAtSize(t, size), y, size, font, color });
  }
  private center(text: string, xMid: number, y: number, size: number, font: PDFFont, color: RGB) {
    const t = pdfSafe(text);
    this.page.drawText(t, { x: xMid - font.widthOfTextAtSize(t, size) / 2, y, size, font, color });
  }

  wrap(text: string, size: number, maxWidth: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  /** Start a new page when fewer than `h` points remain above the footer. */
  ensure(h: number) {
    if (this.y - h >= BOTTOM) return;
    this.page = this.doc.addPage([W, H]);
    this.y = H - 48;
  }

  /** Logo, big navy title with its reference lines, company block and the green rule. */
  header(title: string, rightLines: { text: string; strong?: boolean }[], company: CompanyBlock, stamp?: { text: string; color: RGB }) {
    const logoW = 111.6;
    const logoH = (LOGO_STACKED_SIZE.height / LOGO_STACKED_SIZE.width) * logoW;
    this.page.drawImage(this.logo, { x: L, y: 756 - logoH, width: logoW, height: logoH });
    this.right(title, R, 723.6, 30, this.bold, ink.navy);
    let ry = 702;
    for (const l of rightLines) {
      if (l.strong) this.right(l.text, R, ry - 1.4, 10, this.bold, ink.navy);
      else this.right(l.text, R, ry, 10, this.font, ink.muted);
      ry -= l.strong ? 14.4 : 12.96;
    }
    if (stamp) this.right(stamp.text, R, ry - 6, 13, this.bold, stamp.color);
    let cy = 630.98;
    this.draw(company.legalName, L, cy, 11, this.bold, ink.navy);
    cy -= 12.24;
    for (const l of [company.address, [company.phone, company.email].filter(Boolean).join("  |  "), company.permits].filter(Boolean)) {
      this.draw(l, L, cy, 9.5, this.font, ink.muted);
      cy -= 12.24;
    }
    const ruleY = Math.min(580.58, cy + 2);
    this.page.drawLine({ start: { x: L, y: ruleY }, end: { x: R, y: ruleY }, thickness: 2.5, color: ink.green });
    this.y = ruleY - 25.2;
  }

  /** Two columns of labelled blocks, e.g. BILL TO | SERVICE. The first line of `name` blocks is bold navy. */
  columns(cols: { label: string; name?: string; lines: string[] }[][]) {
    const xs = [L, 316.8];
    const top = this.y;
    let lowest = top;
    cols.forEach((blocks, ci) => {
      let y = top;
      for (const b of blocks) {
        this.draw(b.label, xs[ci]!, y, 10, this.bold, ink.green);
        y -= 15.84 * this.k;
        if (b.name) {
          // Shrink a long name to stay on one line (down to 10pt) before wrapping.
          let size = 12;
          while (size > 10 && this.bold.widthOfTextAtSize(pdfSafe(b.name), size) > 266) size -= 0.5;
          for (const l of this.wrap(b.name, size, 266, this.bold)) {
            this.draw(l, xs[ci]!, y, size, this.bold, ink.navy);
            y -= 14.4 * this.k;
          }
        }
        for (const line of b.lines) {
          for (const l of this.wrap(line, 10.5, 245)) {
            this.draw(l, xs[ci]!, y, 10.5, this.font, ink.body);
            y -= 12.96 * this.k;
          }
        }
        y -= 7.2 * this.k;
      }
      lowest = Math.min(lowest, y);
    });
    this.y = lowest - 14;
  }

  paragraph(text: string, opts: { size?: number; font?: PDFFont; color?: RGB; indent?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const leading = size * (1.05 + 0.14 * this.k);
    const x = L + (opts.indent ?? 0);
    for (const l of this.wrap(text, size, R - x, opts.font ?? this.font)) {
      this.ensure(leading);
      this.draw(l, x, this.y, size, opts.font ?? this.font, opts.color ?? ink.body);
      this.y -= leading;
    }
    this.y -= (opts.gap ?? 4) * this.k;
  }

  bullet(text: string) {
    const lines = this.wrap(text, 10, R - L - 13);
    this.ensure(12 * Math.min(lines.length, 2));
    this.draw("•", L, this.y, 10, this.bold, ink.green);
    for (const l of lines) {
      this.ensure(12);
      this.draw(l, L + 12.96, this.y, 10, this.font, ink.body);
      this.y -= 10 * (1.05 + 0.14 * this.k);
    }
    this.y -= 4.2 * this.k;
  }

  /** Paragraphs separated by blank lines; lines starting with "•" or "-" become bullets. */
  richText(body: string) {
    for (const block of body.split(/\n\s*\n/)) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      let para: string[] = [];
      const flush = () => {
        if (para.length) this.paragraph(para.join(" "), { gap: 4 });
        para = [];
      };
      for (const l of lines) {
        if (/^[•\-*]\s+/.test(l)) {
          flush();
          this.bullet(l.replace(/^[•\-*]\s+/, ""));
        } else para.push(l);
      }
      flush();
    }
  }

  /** Concept heading inside a proposal, e.g. "HOLLANDS COFFEE — Grease Trap Service". */
  subheading(text: string) {
    this.ensure(70);
    this.draw(text, L, this.y, 11, this.bold, ink.navy);
    this.y -= 10 * this.k;
  }

  /** Report section title with a thin rule under it. */
  sectionTitle(text: string) {
    this.ensure(48);
    this.draw(text.toUpperCase(), L, this.y, 11, this.bold, ink.navy);
    this.page.drawLine({ start: { x: L, y: this.y - 4.32 }, end: { x: R, y: this.y - 4.32 }, thickness: 0.5, color: ink.border });
    this.y -= 20.16 * this.k;
  }

  table(rows: TableRow[]) {
    const head = 22.32;
    const drawHead = () => {
      this.page.drawRectangle({ x: L, y: this.y - head, width: R - L, height: head, color: ink.navy });
      const ty = this.y - head + 7.2;
      this.draw("DESCRIPTION", 55.44, ty, 9.5, this.bold, ink.white);
      this.center("QTY", 352, ty, 9.5, this.bold, ink.white);
      this.center("RATE", 432, ty, 9.5, this.bold, ink.white);
      this.right("AMOUNT", R - 8.64, ty, 9.5, this.bold, ink.white);
      this.y -= head;
    };
    this.ensure(head + 30);
    drawHead();
    rows.forEach((r, i) => {
      const desc = this.wrap(r.description, 10, 270);
      const h = Math.max(28.8 * this.k, 16.8 * this.k + desc.length * 12);
      if (this.y - h < BOTTOM) {
        this.ensure(h + head + 30);
        drawHead();
      }
      if (i % 2 === 0) this.page.drawRectangle({ x: L, y: this.y - h, width: R - L, height: h, color: ink.rowAlt });
      const ty = this.y - h / 2 - 3.6 - ((desc.length - 1) * 12) / 2;
      desc.forEach((l, k) => this.draw(l, 55.44, ty - k * 12, 10, this.font, ink.cell));
      this.center(r.qty, 352, ty, 10, this.font, ink.cell);
      this.center(r.rate, 432, ty, 10, this.font, ink.cell);
      this.right(r.amount, R - 8.64, ty, 10, this.bold, ink.cell);
      this.y -= h;
    });
    this.page.drawLine({ start: { x: L, y: this.y }, end: { x: R, y: this.y }, thickness: 0.75, color: ink.border });
    this.y -= 18.72 * this.k;
  }

  /** Right-aligned label: value rows under a table. */
  summary(rows: { label: string; value: string; bold?: boolean }[]) {
    for (const r of rows) {
      this.ensure(17.28);
      const f = r.bold ? this.bold : this.font;
      this.right(r.label, 486, this.y, 10.5, f, ink.body);
      this.right(r.value, R - 8.64, this.y, 10.5, f, ink.body);
      this.y -= 17.28 * this.k;
    }
  }

  totalBar(label: string, value: string) {
    this.ensure(40);
    const x = Math.min(313.2, R - 30 - this.bold.widthOfTextAtSize(pdfSafe(label), 12) - this.bold.widthOfTextAtSize(pdfSafe(value), 12) - 22);
    this.y -= 4 * this.k;
    this.page.drawRectangle({ x, y: this.y - 20.4, width: R - x, height: 28.08, color: ink.green });
    this.draw(label, x + 10.8, this.y - 11.76, 12, this.bold, ink.white);
    this.right(value, R - 8.64, this.y - 11.76, 12, this.bold, ink.white);
    this.y -= 34 * this.k;
  }

  /** "NOTE" block. */
  note(lines: string[], title = "NOTE") {
    const text = lines.filter(Boolean);
    if (!text.length) return;
    this.ensure(40);
    this.draw(title, L, this.y, 10, this.bold, ink.navy);
    this.y -= 14.4 * this.k;
    for (const t of text) this.paragraph(t, { gap: 0 });
    this.y -= 8 * this.k;
  }

  italicLine(text: string) {
    this.ensure(20);
    this.paragraph(text, { size: 9.5, font: this.italic, color: ink.muted, gap: 6 });
  }

  async save(): Promise<Uint8Array> {
    for (const page of this.doc.getPages()) {
      this.page = page;
      page.drawLine({ start: { x: L, y: 61.2 }, end: { x: R, y: 61.2 }, thickness: 2, color: ink.green });
      this.footerLines.forEach((l, i) => this.center(l, W / 2, 44.64 - i * 11.52, 9, this.font, ink.muted));
    }
    return this.doc.save();
  }
}

/** "Sewer Squad Services LLC • 5718 Westheimer Rd, Houston, TX • 346-244-5579 • Sales@…" */
/**
 * Builds the document at normal spacing and, if that spills onto an extra page, once more with
 * slightly tighter spacing, keeping whichever uses fewer pages (one-page documents stay one page).
 */
export async function fitPages(build: (k: number) => Promise<BrandedPdf>): Promise<Uint8Array> {
  const normal = await build(1);
  if (normal.doc.getPageCount() > 1) {
    const tight = await build(0.86);
    if (tight.doc.getPageCount() < normal.doc.getPageCount()) return tight.save();
  }
  return normal.save();
}

export function companyLine(c: CompanyBlock, withName = true) {
  return [withName ? c.legalName : null, c.address, c.phone, c.email].filter(Boolean).join("  •  ");
}
