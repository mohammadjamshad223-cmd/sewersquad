/**
 * Invoice arithmetic using scaled BigInt integers — no floating point anywhere.
 * quantity: up to 3 decimals, unit price: cents with up to 4 decimals.
 * Rounding: half away from zero, to whole cents.
 */
export type LineInput = {
  kind: string;
  quantity: string | number;
  unitPriceCents: string | number; // e.g. "35", "6.5"
  taxable?: boolean;
};

export type InvoiceTotals = {
  lines: { amountCents: number }[];
  subtotalCents: number; // sum of non-discount lines
  discountCents: number; // positive number
  taxableBaseCents: number;
  taxCents: number;
  totalCents: number;
};

const Q_SCALE = 3; // quantity decimals
const P_SCALE = 4; // price decimals

function toScaled(value: string | number, scale: number): bigint {
  const s = typeof value === "number" ? value.toFixed(scale) : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`Invalid decimal: ${value}`);
  const negative = s.startsWith("-");
  const [whole, frac = ""] = s.replace("-", "").split(".") as [string, string?];
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) throw new Error(`Too many decimal places: ${value}`);
  const v = BigInt(whole) * 10n ** BigInt(scale) + BigInt((frac + "0".repeat(scale)).slice(0, scale) || "0");
  return negative ? -v : v;
}

/** Divide and round half away from zero. */
function divRound(n: bigint, d: bigint): bigint {
  const neg = n < 0n !== d < 0n;
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  const q = (an * 2n + ad) / (ad * 2n);
  return neg ? -q : q;
}

export function lineAmountCents(quantity: string | number, unitPriceCents: string | number): number {
  const q = toScaled(quantity, Q_SCALE);
  const p = toScaled(unitPriceCents, P_SCALE);
  return Number(divRound(q * p, 10n ** BigInt(Q_SCALE + P_SCALE)));
}

export function computeInvoiceTotals(lines: LineInput[], taxRateBps: number): InvoiceTotals {
  if (!Number.isInteger(taxRateBps) || taxRateBps < 0) throw new Error("Invalid tax rate");
  const computed = lines.map((l) => {
    let amount = lineAmountCents(l.quantity, l.unitPriceCents);
    if (l.kind === "DISCOUNT" && amount > 0) amount = -amount; // discounts are always reductions
    if (l.kind !== "DISCOUNT" && amount < 0) throw new Error("Only discount lines may be negative");
    return { ...l, amountCents: amount };
  });
  const charges = computed.filter((l) => l.kind !== "DISCOUNT");
  const subtotal = charges.reduce((s, l) => s + l.amountCents, 0);
  const discount = -computed.filter((l) => l.kind === "DISCOUNT").reduce((s, l) => s + l.amountCents, 0);
  if (discount > subtotal) throw new Error("Discounts cannot exceed the subtotal");
  const taxableSubtotal = charges.filter((l) => l.taxable !== false).reduce((s, l) => s + l.amountCents, 0);
  // Discounts reduce the taxable base proportionally to the taxable share of the subtotal.
  const taxableDiscount = subtotal === 0 ? 0 : Number(divRound(BigInt(discount) * BigInt(taxableSubtotal), BigInt(subtotal)));
  const taxableBase = taxableSubtotal - taxableDiscount;
  const tax = Number(divRound(BigInt(taxableBase) * BigInt(taxRateBps), 10_000n));
  return {
    lines: computed.map((l) => ({ amountCents: l.amountCents })),
    subtotalCents: subtotal,
    discountCents: discount,
    taxableBaseCents: taxableBase,
    taxCents: tax,
    totalCents: subtotal - discount + tax,
  };
}

export type InvoiceStatus = "DRAFT" | "SENT" | "VIEWED" | "PARTIALLY_PAID" | "PAID" | "OVERDUE" | "VOID" | "WRITTEN_OFF";

/** Derive the payment-driven status of an issued invoice. Terminal/manual statuses are preserved. */
export function deriveInvoiceStatus(inv: {
  status: InvoiceStatus;
  totalCents: number;
  amountPaidCents: number;
  dueDate: string; // date key
  viewedAt?: Date | null;
  today: string; // date key
}): InvoiceStatus {
  if (inv.status === "DRAFT" || inv.status === "VOID" || inv.status === "WRITTEN_OFF") return inv.status;
  const balance = inv.totalCents - inv.amountPaidCents;
  if (balance <= 0) return "PAID";
  if (inv.today > inv.dueDate) return "OVERDUE";
  if (inv.amountPaidCents > 0) return "PARTIALLY_PAID";
  return inv.viewedAt ? "VIEWED" : "SENT";
}

export type AllocationTarget = { invoiceId: string; balanceCents: number; allowPartial: boolean };

/**
 * Allocate a payment across invoices in the given order (oldest first by convention).
 * Overpayment is rejected — the platform does not hold customer credit balances.
 */
export function allocatePayment(amountCents: number, targets: AllocationTarget[]): { invoiceId: string; amountCents: number }[] {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Payment amount must be a positive number of cents");
  const totalBalance = targets.reduce((s, t) => s + t.balanceCents, 0);
  if (amountCents > totalBalance) throw new Error("Payment exceeds the outstanding balance");
  const out: { invoiceId: string; amountCents: number }[] = [];
  let remaining = amountCents;
  for (const t of targets) {
    if (remaining === 0) break;
    if (t.balanceCents <= 0) continue;
    const amt = Math.min(remaining, t.balanceCents);
    if (amt < t.balanceCents && !t.allowPartial) throw new Error("Partial payment is not permitted for one of the selected invoices");
    out.push({ invoiceId: t.invoiceId, amountCents: amt });
    remaining -= amt;
  }
  return out;
}

/** Aging bucket for receivables, by days past due. */
export function agingBucket(dueDate: string, today: string): "current" | "1_30" | "31_60" | "61_90" | "90_plus" {
  const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "90_plus";
}
