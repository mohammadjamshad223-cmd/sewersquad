import { describe, expect, it } from "vitest";
import { agingBucket, allocatePayment, computeInvoiceTotals, deriveInvoiceStatus, lineAmountCents } from "@/domain/invoice-math";

describe("invoice math", () => {
  it("multiplies fractional quantities and fractional-cent rates exactly", () => {
    expect(lineAmountCents("1250", "35")).toBe(43_750); // 1,250 gal × $0.35
    expect(lineAmountCents("1000", "6.5")).toBe(6_500); // × $0.065
    expect(lineAmountCents("0.333", "100")).toBe(33); // 33.3¢ → 33¢
    expect(lineAmountCents("0.335", "100")).toBe(34); // half rounds away from zero
    expect(lineAmountCents("3", "0.1")).toBe(0); // 0.3¢ rounds to 0
  });

  it("does not suffer float errors", () => {
    expect(lineAmountCents("0.1", "30")).toBe(3);
    expect(computeInvoiceTotals([{ kind: "SERVICE", quantity: 1, unitPriceCents: 10 }, { kind: "SERVICE", quantity: 1, unitPriceCents: 20 }], 0).totalCents).toBe(30);
  });

  it("applies discounts before tax, proportionally to the taxable share", () => {
    const t = computeInvoiceTotals(
      [
        { kind: "FLAT_RATE", quantity: 1, unitPriceCents: 30_000, taxable: true },
        { kind: "DISPOSAL_FEE", quantity: 1, unitPriceCents: 10_000, taxable: false },
        { kind: "DISCOUNT", quantity: 1, unitPriceCents: 4_000 },
      ],
      825,
    );
    expect(t.subtotalCents).toBe(40_000);
    expect(t.discountCents).toBe(4_000);
    expect(t.taxableBaseCents).toBe(27_000); // 30,000 − 3,000 (75% of discount)
    expect(t.taxCents).toBe(2_228); // 27,000 × 8.25% = 2,227.5 → 2,228
    expect(t.totalCents).toBe(38_228);
  });

  it("rejects discounts larger than the subtotal and negative charges", () => {
    expect(() => computeInvoiceTotals([{ kind: "SERVICE", quantity: 1, unitPriceCents: 100 }, { kind: "DISCOUNT", quantity: 1, unitPriceCents: 200 }], 0)).toThrow();
    expect(() => computeInvoiceTotals([{ kind: "SERVICE", quantity: -1, unitPriceCents: 100 }], 0)).toThrow();
  });

  it("derives statuses from payments and due date", () => {
    const base = { status: "SENT" as const, totalCents: 10_000, dueDate: "2026-05-01", today: "2026-04-20" };
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 0 })).toBe("SENT");
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 0, viewedAt: new Date() })).toBe("VIEWED");
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 4_000 })).toBe("PARTIALLY_PAID");
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 10_000 })).toBe("PAID");
    expect(deriveInvoiceStatus({ ...base, amountPaidCents: 4_000, today: "2026-05-02" })).toBe("OVERDUE");
    expect(deriveInvoiceStatus({ ...base, status: "VOID", amountPaidCents: 0 })).toBe("VOID");
  });

  it("allocates partial payments oldest-first and rejects overpayment", () => {
    const targets = [
      { invoiceId: "a", balanceCents: 5_000, allowPartial: true },
      { invoiceId: "b", balanceCents: 7_000, allowPartial: true },
    ];
    expect(allocatePayment(8_000, targets)).toEqual([
      { invoiceId: "a", amountCents: 5_000 },
      { invoiceId: "b", amountCents: 3_000 },
    ]);
    expect(() => allocatePayment(12_001, targets)).toThrow(/exceeds/);
    expect(() => allocatePayment(3_000, [{ invoiceId: "c", balanceCents: 5_000, allowPartial: false }])).toThrow(/Partial/);
  });

  it("buckets receivables by days past due", () => {
    expect(agingBucket("2026-05-01", "2026-05-01")).toBe("current");
    expect(agingBucket("2026-05-01", "2026-05-31")).toBe("1_30");
    expect(agingBucket("2026-05-01", "2026-06-01")).toBe("31_60");
    expect(agingBucket("2026-05-01", "2026-07-30")).toBe("61_90");
    expect(agingBucket("2026-05-01", "2026-07-31")).toBe("90_plus");
  });
});
