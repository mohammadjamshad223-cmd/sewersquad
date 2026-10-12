import { formatCents, formatRateCents } from "@/lib/money";

/** How a priced line prints on invoices and proposals, matching the owner's templates. */
export type DocLine = { kind: string; description: string; quantity: string; unitPriceCents: string; amountCents: number };

/** Trap service lines: the base the manifest fee percentage applies to. */
export const MANIFEST_FEE_BASE_KINDS = ["PER_GALLON", "FLAT_RATE", "SERVICE", "MINIMUM_CHARGE"] as const;

const DASH = "—";
const pct = (bps: number) => `${(bps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`;
const qtyText = (q: string) => Number(q).toLocaleString("en-US", { maximumFractionDigits: 3 });

export function lineRow(l: DocLine, manifestFeeBps: number, feeWording: "service total" | "service" = "service total") {
  const amount = l.amountCents < 0 ? `-${formatCents(-l.amountCents)}` : formatCents(l.amountCents);
  switch (l.kind) {
    case "PER_GALLON":
      return { description: l.description, qty: `${qtyText(l.quantity)} gal`, rate: `${formatRateCents(l.unitPriceCents)} / gallon`, amount };
    case "MANIFEST_FEE":
      return { description: l.description, qty: DASH, rate: `${pct(manifestFeeBps)} of ${feeWording}`, amount };
    case "DISCOUNT":
      return { description: l.description, qty: DASH, rate: "Discount", amount };
    default: {
      const q = Number(l.quantity);
      return q === 1 || q === 0 ? { description: l.description, qty: DASH, rate: "Flat rate", amount } : { description: l.description, qty: qtyText(l.quantity), rate: `${formatRateCents(l.unitPriceCents)} each`, amount };
    }
  }
}

/** Short label for the summary under the table ("Pumping:", "Manifest fee (4%):"). */
export function summaryLabel(l: DocLine, manifestFeeBps: number) {
  if (l.kind === "MANIFEST_FEE") return `Manifest fee (${pct(manifestFeeBps)})`;
  if ((l.kind === "PER_GALLON" || l.kind === "FLAT_RATE") && /pumping/i.test(l.description)) return "Pumping";
  if (l.kind === "DISCOUNT") return "Discount";
  return l.description.length > 38 ? `${l.description.slice(0, 36)}…` : l.description;
}

/**
 * The NOTE paragraph the owner writes by hand, generated from the lines:
 * "Service billed at $0.89 per gallon for 750 gallons pumped, plus a $79.99 trench drain clearing.
 *  A 4% City of Houston manifest fee applies to the service total."
 */
export function autoNote(lines: DocLine[], manifestFeeBps: number): string[] {
  const out: string[] = [];
  const perGallon = lines.find((l) => l.kind === "PER_GALLON" && Number(l.quantity) > 0);
  const extras = lines.filter((l) => l !== perGallon && !["MANIFEST_FEE", "DISCOUNT", "PER_GALLON"].includes(l.kind) && l.amountCents > 0);
  const extraText = extras.map((e) => (/itemized/i.test(e.description) ? `${formatCents(e.amountCents)} in additional services itemized on the original invoice` : `a ${formatCents(e.amountCents)} ${e.description.toLowerCase()}`));
  if (perGallon) {
    const first = `Service billed at ${formatRateCents(perGallon.unitPriceCents)} per gallon for ${qtyText(perGallon.quantity)} gallons pumped`;
    out.push(extraText.length ? `${first}, plus ${joinAnd(extraText)}.` : `${first}.`);
  } else if (extras.length === 1 && extras[0]!.kind !== "OTHER") {
    out.push(`${extras[0]!.description} billed at a flat rate of ${formatCents(extras[0]!.amountCents)}.`);
  }
  const fee = lines.find((l) => l.kind === "MANIFEST_FEE" && l.amountCents > 0);
  if (fee) out.push(`A ${pct(manifestFeeBps)} ${/city of houston/i.test(fee.description) ? "City of Houston manifest fee" : "manifest fee"} applies to the service total.`);
  return out;
}

function joinAnd(xs: string[]) {
  return xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Manifest fee for a set of lines, rounded half-up to the cent. */
export function manifestFeeCents(lines: { kind: string; amountCents: number }[], bps: number) {
  const base = lines.filter((l) => (MANIFEST_FEE_BASE_KINDS as readonly string[]).includes(l.kind)).reduce((s, l) => s + l.amountCents, 0);
  return base > 0 ? Math.round((base * bps) / 10_000) : 0;
}

export const MANIFEST_FEE_LABEL: Record<string, string> = {
  NONE: "No manifest fee",
  STANDARD: "Manifest fee",
  CITY_OF_HOUSTON: "City of Houston manifest fee",
  WAIVED: "Manifest fee waived",
};
