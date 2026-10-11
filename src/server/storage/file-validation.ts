/**
 * Upload validation by content (magic bytes), not by the client-supplied name or MIME type.
 * Only document and image formats needed by the platform are accepted. SVG/HTML are rejected
 * because they can carry script.
 */
export type DetectedType = { mime: string; ext: string; kind: "pdf" | "image" | "office" | "text" };

export const ALLOWED_DESCRIPTION = "PDF, JPEG, PNG, WEBP, HEIC, CSV/TXT, DOCX or XLSX";

export function detectFileType(bytes: Uint8Array, declaredName: string): DetectedType | null {
  const b = bytes;
  const starts = (sig: number[], offset = 0) => sig.every((v, i) => b[offset + i] === v);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: "application/pdf", ext: "pdf", kind: "pdf" };
  if (starts([0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: "image/png", ext: "png", kind: "image" };
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return { mime: "image/webp", ext: "webp", kind: "image" };
  if (starts([0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (["heic", "heix", "mif1", "msf1", "hevc"].includes(brand)) return { mime: "image/heic", ext: "heic", kind: "image" };
  }
  const lower = declaredName.toLowerCase();
  if (starts([0x50, 0x4b, 0x03, 0x04])) {
    if (lower.endsWith(".docx")) return { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx", kind: "office" };
    if (lower.endsWith(".xlsx")) return { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ext: "xlsx", kind: "office" };
    return null;
  }
  if ((lower.endsWith(".csv") || lower.endsWith(".txt")) && isPlainText(b)) {
    return lower.endsWith(".csv") ? { mime: "text/csv", ext: "csv", kind: "text" } : { mime: "text/plain", ext: "txt", kind: "text" };
  }
  return null;
}

function isPlainText(b: Uint8Array): boolean {
  const sample = b.slice(0, 4096);
  for (const c of sample) {
    if (c === 0) return false;
    if (c < 0x09 || (c > 0x0d && c < 0x20)) return false;
  }
  const text = new TextDecoder("utf-8", { fatal: false }).decode(sample).toLowerCase();
  return !text.includes("<script") && !text.includes("<html");
}

export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const cleaned = base.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim();
  return (cleaned || "file").slice(0, 120);
}
