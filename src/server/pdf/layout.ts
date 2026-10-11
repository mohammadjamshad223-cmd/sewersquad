import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";
import { brand } from "@/config/brand";
import { LOGO_PNG_BASE64, LOGO_SIZE } from "./logo-data";

const PAGE = { w: 612, h: 792, margin: 48 }; // US Letter

function hex(c: string): RGB {
  const n = parseInt(c.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export const colors = { primary: hex(brand.colors.primary), accent: hex(brand.colors.accent), text: hex(brand.colors.text), muted: hex(brand.colors.muted), border: hex(brand.colors.border), subtle: rgb(0.965, 0.97, 0.98), danger: rgb(0.75, 0.1, 0.1) };

/** Standard PDF fonts only support WinAnsi; replace characters outside it. */
export function pdfSafe(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/–/g, "-")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF—•€]/g, "?");
}

export class PdfWriter {
  doc!: PDFDocument;
  page!: PDFPage;
  font!: PDFFont;
  bold!: PDFFont;
  logo!: PDFImage;
  y = 0;
  pageNo = 0;
  private footer: string;

  private constructor(footer: string) {
    this.footer = footer;
  }

  static async create(title: string, footer: string) {
    const w = new PdfWriter(footer);
    w.doc = await PDFDocument.create();
    w.doc.setTitle(title);
    w.doc.setProducer(`${brand.name} platform`);
    w.doc.setCreator(brand.name);
    w.font = await w.doc.embedFont(StandardFonts.Helvetica);
    w.bold = await w.doc.embedFont(StandardFonts.HelveticaBold);
    w.logo = await w.doc.embedPng(Buffer.from(LOGO_PNG_BASE64, "base64"));
    w.newPage();
    return w;
  }

  newPage() {
    if (this.page) this.drawFooter();
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pageNo++;
    this.y = PAGE.h - PAGE.margin;
  }

  private drawFooter() {
    this.page.drawLine({ start: { x: PAGE.margin, y: 40 }, end: { x: PAGE.w - PAGE.margin, y: 40 }, thickness: 0.5, color: colors.border });
    this.page.drawText(pdfSafe(this.footer), { x: PAGE.margin, y: 28, size: 7.5, font: this.font, color: colors.muted });
    this.page.drawText(`Page ${this.pageNo}`, { x: PAGE.w - PAGE.margin - 30, y: 28, size: 7.5, font: this.font, color: colors.muted });
  }

  ensure(height: number) {
    if (this.y - height < 60) this.newPage();
  }

  get width() {
    return PAGE.w - PAGE.margin * 2;
  }
  get left() {
    return PAGE.margin;
  }

  wrap(text: string, size: number, maxWidth: number, font = this.font): string[] {
    const out: string[] = [];
    for (const para of pdfSafe(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
          out.push(line);
          line = word;
        } else line = candidate;
      }
      out.push(line);
    }
    return out;
  }

  text(text: string, opts: { size?: number; bold?: boolean; color?: RGB; x?: number; maxWidth?: number; gap?: number } = {}) {
    const size = opts.size ?? 9.5;
    const font = opts.bold ? this.bold : this.font;
    const lines = this.wrap(text, size, opts.maxWidth ?? this.width, font);
    for (const l of lines) {
      this.ensure(size + 4);
      this.page.drawText(l, { x: opts.x ?? this.left, y: this.y - size, size, font, color: opts.color ?? colors.text });
      this.y -= size + 3.5;
    }
    this.y -= opts.gap ?? 0;
  }

  header(docTitle: string, subtitle: string, rightLines: string[]) {
    this.page.drawRectangle({ x: 0, y: PAGE.h - 6, width: PAGE.w, height: 6, color: colors.primary });
    this.page.drawRectangle({ x: 0, y: PAGE.h - 8, width: PAGE.w, height: 2, color: colors.accent });
    const logoH = 36;
    const logoW = (LOGO_SIZE.width / LOGO_SIZE.height) * logoH;
    this.page.drawImage(this.logo, { x: this.left, y: this.y - logoH + 4, width: logoW, height: logoH });
    this.page.drawText(pdfSafe(docTitle), { x: this.left, y: this.y - logoH - 12, size: 11, font: this.bold, color: colors.text });
    this.page.drawText(pdfSafe(subtitle), { x: this.left, y: this.y - logoH - 25, size: 8.5, font: this.font, color: colors.muted });
    let ry = this.y - 12;
    for (const [i, l] of rightLines.entries()) {
      const f = i === 0 ? this.bold : this.font;
      const size = i === 0 ? 11 : 8.5;
      const t = pdfSafe(l);
      this.page.drawText(t, { x: PAGE.w - PAGE.margin - f.widthOfTextAtSize(t, size), y: ry - size, size, font: f, color: i === 0 ? colors.text : colors.muted });
      ry -= size + 4;
    }
    this.y -= Math.max(logoH + 34, 12 + rightLines.length * 13);
    this.rule();
  }

  rule(gap = 10) {
    this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: PAGE.w - PAGE.margin, y: this.y }, thickness: 0.5, color: colors.border });
    this.y -= gap;
  }

  section(title: string, sourceNote?: string) {
    this.ensure(40);
    this.y -= 6;
    this.page.drawText(pdfSafe(title.toUpperCase()), { x: this.left, y: this.y - 9, size: 8.5, font: this.bold, color: colors.primary });
    if (sourceNote) {
      const t = pdfSafe(sourceNote);
      this.page.drawText(t, { x: PAGE.w - PAGE.margin - this.font.widthOfTextAtSize(t, 7.5), y: this.y - 9, size: 7.5, font: this.font, color: colors.muted });
    }
    this.y -= 15;
    this.rule(8);
  }

  /** Two-column label/value grid. */
  fields(items: [string, string | null | undefined][], columns = 2) {
    const colW = this.width / columns;
    for (let i = 0; i < items.length; i += columns) {
      const row = items.slice(i, i + columns);
      const heights = row.map(([, v]) => this.wrap(v || "—", 9.5, colW - 12).length);
      const h = 12 + Math.max(...heights) * 13;
      this.ensure(h + 4);
      row.forEach(([label, value], ci) => {
        const x = this.left + ci * colW;
        this.page.drawText(pdfSafe(label), { x, y: this.y - 8, size: 7.5, font: this.font, color: colors.muted });
        let ly = this.y - 21;
        for (const l of this.wrap(value || "—", 9.5, colW - 12)) {
          this.page.drawText(l, { x, y: ly, size: 9.5, font: value ? this.font : this.font, color: value ? colors.text : colors.muted });
          ly -= 13;
        }
      });
      this.y -= h + 4;
    }
  }

  table(headers: string[], rows: string[][], widths: number[], align: ("left" | "right")[] = []) {
    const total = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / total) * this.width);
    const drawRow = (cells: string[], bold: boolean, bg?: RGB) => {
      const lines = cells.map((c, i) => this.wrap(c, 9, ws[i]! - 8, bold ? this.bold : this.font));
      const h = Math.max(...lines.map((l) => l.length)) * 12 + 8;
      this.ensure(h);
      if (bg) this.page.drawRectangle({ x: this.left, y: this.y - h, width: this.width, height: h, color: bg });
      let x = this.left;
      cells.forEach((_, i) => {
        let ly = this.y - 13;
        for (const l of lines[i]!) {
          const f = bold ? this.bold : this.font;
          const tx = align[i] === "right" ? x + ws[i]! - 4 - f.widthOfTextAtSize(l, 9) : x + 4;
          this.page.drawText(l, { x: tx, y: ly, size: 9, font: f, color: colors.text });
          ly -= 12;
        }
        x += ws[i]!;
      });
      this.y -= h;
      this.page.drawLine({ start: { x: this.left, y: this.y }, end: { x: this.left + this.width, y: this.y }, thickness: 0.4, color: colors.border });
    };
    drawRow(headers, true, colors.subtle);
    rows.forEach((r) => drawRow(r, false));
    this.y -= 8;
  }

  /** Right-aligned totals block. */
  totals(rows: [string, string, boolean?][]) {
    for (const [label, value, strong] of rows) {
      this.ensure(16);
      const f = strong ? this.bold : this.font;
      const size = strong ? 11 : 9.5;
      const v = pdfSafe(value);
      this.page.drawText(pdfSafe(label), { x: this.left + this.width * 0.55, y: this.y - size, size, font: f, color: strong ? colors.text : colors.muted });
      this.page.drawText(v, { x: this.left + this.width - f.widthOfTextAtSize(v, size), y: this.y - size, size, font: f, color: colors.text });
      this.y -= size + 6;
    }
  }

  async image(pngBytes: Uint8Array, x: number, maxW: number, maxH: number) {
    const img = await this.doc.embedPng(pngBytes);
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    this.page.drawImage(img, { x, y: this.y - h, width: w, height: h });
    return h;
  }

  stamp(text: string, color: RGB = colors.danger) {
    const t = pdfSafe(text);
    this.page.drawText(t, { x: PAGE.w - PAGE.margin - this.bold.widthOfTextAtSize(t, 10), y: PAGE.h - 20, size: 10, font: this.bold, color });
  }

  async save(): Promise<Uint8Array> {
    this.drawFooter();
    return this.doc.save();
  }
}
