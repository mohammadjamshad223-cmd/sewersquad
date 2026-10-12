import { describe, expect, it } from "vitest";
import { normalizeBillLines, summarizeBills } from "@/server/services/disposal-bills";

describe("disposal bill lines", () => {
  it("uses the typed amount, else gallons × fractional-cent rate", () => {
    const [a, b] = normalizeBillLines([
      { description: "Grease", gallons: "1750", rate: "0.185" },
      { description: "Minimum charge", amount: "$175.00", manifests: "1; 2  3" },
    ]);
    expect(a!.amountCents).toBe(32_375);
    expect(a!.ratePerGallonCents!.toString()).toBe("18.5");
    expect(b!.amountCents).toBe(17_500);
    expect(b!.manifestNumbers).toEqual(["1", "2", "3"]);
  });
  it("rejects fractional gallons and bad amounts", () => {
    expect(() => normalizeBillLines([{ description: "x", gallons: "10.5", rate: "0.1" }])).toThrow(/whole number/);
    expect(() => normalizeBillLines([{ description: "x", amount: "abc" }])).toThrow(/amount/);
  });
});

describe("summarizeBills", () => {
  const d = (k: string) => new Date(`${k}T00:00:00Z`);
  it("excludes void bills and groups by vendor and month", () => {
    const s = summarizeBills([
      { facilityId: "a", facilityName: "A", invoiceDate: d("2026-06-30"), status: "OPEN", totalCents: 37_000, gallons: 2_000, gallonCostCents: 37_000 },
      { facilityId: "a", facilityName: "A", invoiceDate: d("2026-07-26"), status: "PAID", totalCents: 18_500, gallons: 1_000, gallonCostCents: 18_500 },
      { facilityId: "b", facilityName: "B", invoiceDate: d("2026-07-13"), status: "OPEN", totalCents: 30_000, gallons: 2_000, gallonCostCents: 30_000 },
      { facilityId: "b", facilityName: "B", invoiceDate: d("2026-07-13"), status: "VOID", totalCents: 99_999, gallons: 9_999, gallonCostCents: 99_999 },
      { facilityId: "b", facilityName: "B", invoiceDate: d("2026-07-20"), status: "OPEN", totalCents: 10_000, gallons: 0, gallonCostCents: 0 },
    ]);
    expect(s.billedCents).toBe(95_500);
    expect(s.openCents).toBe(77_000); // amount-only bills count toward totals
    expect(s.paidCents).toBe(18_500);
    expect(s.centsPerGallon).toBeCloseTo(17.1); // …but not toward cost per gallon
    expect(s.byVendor.map((v) => [v.name, v.billedCents, v.openCents])).toEqual([["A", 55_500, 37_000], ["B", 40_000, 40_000]]);
    expect(s.byMonth.map((m) => [m.month, m.billedCents])).toEqual([["2026-06", 37_000], ["2026-07", 58_500]]);
  });
});
