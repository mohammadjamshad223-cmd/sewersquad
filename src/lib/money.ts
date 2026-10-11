/** Money is always integer cents. Never use floating point for stored amounts. */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return usd.format(cents / 100);
}

/** Format a fractional-cent rate such as 6.5 (cents) → "$0.065". */
export function formatRateCents(cents: number | string | { toString(): string } | null | undefined, unit?: string): string {
  if (cents === null || cents === undefined) return "—";
  const n = Number(cents.toString());
  const dollars = n / 100;
  const digits = Number.isInteger(n) ? 2 : Math.min(4, Math.max(2, (n.toString().split(".")[1]?.length ?? 0) + 2));
  const s = `$${dollars.toFixed(digits)}`;
  return unit ? `${s}/${unit}` : s;
}

/**
 * Parse a user-entered dollar string ("1,234.5", "$12") into integer cents using string
 * arithmetic, so "0.1 + 0.2" style float errors cannot occur.
 */
export function parseDollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^-?\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith("-");
  const [whole, frac = ""] = cleaned.replace("-", "").split(".") as [string, string?];
  const cents = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return negative ? -cents : cents;
}

/** Parse a dollar rate allowing up to 4 decimal places, returning cents as a decimal string. */
export function parseDollarRateToCentsString(input: string): string | null {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{0,6})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".") as [string, string?];
  const padded = (frac + "000000").slice(0, 6);
  // dollars.frac(6) → cents.frac(4)
  const centsWhole = Number(whole) * 100 + Number(padded.slice(0, 2));
  const centsFrac = padded.slice(2).replace(/0+$/, "");
  return centsFrac ? `${centsWhole}.${centsFrac}` : String(centsWhole);
}

export function centsToDollarInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2);
}

export function formatGallons(g: number | null | undefined): string {
  if (g === null || g === undefined) return "—";
  return `${new Intl.NumberFormat("en-US").format(g)} gal`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  return `${(ratio * 100).toFixed(digits)}%`;
}
