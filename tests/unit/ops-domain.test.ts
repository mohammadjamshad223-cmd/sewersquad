import { describe, expect, it } from "vitest";
import { allowedNext, assertTransition, canTransition, emergencyStatusForJob } from "@/domain/job-state";
import { planCapacity } from "@/domain/capacity";
import { reconcile, reconcileEvent } from "@/domain/reconciliation";
import { allocateCostByGallons, computeContribution } from "@/domain/profitability";

describe("job state machine", () => {
  it("allows the standard field workflow", () => {
    const path = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "SUBMITTED"] as const;
    for (let i = 0; i < path.length - 1; i++) {
      const by = i === 0 ? "dispatch" : "driver";
      expect(canTransition(path[i]!, path[i + 1]!, by)).toBe(true);
    }
    expect(canTransition("SUBMITTED", "COMPLETED", "reviewer")).toBe(true);
  });

  it("blocks drivers from approving and skipping steps", () => {
    expect(canTransition("SUBMITTED", "COMPLETED", "driver")).toBe(false);
    expect(canTransition("ASSIGNED", "SUBMITTED", "driver")).toBe(false);
    expect(() => assertTransition("COMPLETED", "IN_PROGRESS", "driver")).toThrow();
    expect(allowedNext("COMPLETED", "dispatch")).toEqual([]);
  });

  it("maps job progress onto emergency status", () => {
    expect(emergencyStatusForJob("EN_ROUTE")).toBe("EN_ROUTE");
    expect(emergencyStatusForJob("COMPLETED")).toBe("COMPLETED");
    expect(emergencyStatusForJob("SCHEDULED")).toBeNull();
  });
});

describe("truck capacity", () => {
  it("warns when estimated load exceeds the tank before a disposal stop", () => {
    const r = planCapacity(3000, [
      { kind: "service", id: "1", label: "A", estimatedGallons: 1500 },
      { kind: "service", id: "2", label: "B", estimatedGallons: 1000 },
      { kind: "service", id: "3", label: "C", estimatedGallons: 800 },
      { kind: "disposal", id: "d", label: "Plant" },
      { kind: "service", id: "4", label: "D", estimatedGallons: 900 },
    ]);
    expect(r.stops.map((s) => s.overCapacity)).toEqual([false, false, true, false, false]);
    expect(r.warnings).toHaveLength(1);
    expect(r.peakLoad).toBe(3300);
  });

  it("flags missing estimates as incomplete", () => {
    const r = planCapacity(3000, [{ kind: "service", id: "1", label: "A", estimatedGallons: null }]);
    expect(r.hasMissingEstimates).toBe(true);
  });
});

describe("disposal reconciliation", () => {
  it("balances when opening + collected − closing equals disposed", () => {
    const r = reconcile({ openingLoadGallons: 200, closingLoadGallons: 100, collectedGallons: 2900, disposedGallons: 3000, adjustmentsGallons: 0 });
    expect(r.discrepancyGallons).toBe(0);
    expect(r.flagged).toBe(false);
  });

  it("flags unexplained discrepancies beyond tolerance", () => {
    const r = reconcile({ openingLoadGallons: 0, closingLoadGallons: 0, collectedGallons: 3000, disposedGallons: 2700, adjustmentsGallons: 0 });
    expect(r.discrepancyGallons).toBe(-300);
    expect(r.flagged).toBe(true);
  });

  it("documented adjustments explain differences", () => {
    const r = reconcileEvent({ gallons: 2700, openingLoadGallons: 0, closingLoadGallons: 0, adjustmentGallons: -300, allocatedGallons: 3000 });
    expect(r.flagged).toBe(false);
  });
});

describe("contribution margin", () => {
  it("is labelled incomplete when costs are missing", () => {
    const r = computeContribution({ revenueCents: 50_000, disposalCostCents: 10_000, laborCostCents: null, truckCostCents: 5_000 });
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["labor cost"]);
    expect(r.contributionCents).toBe(35_000);
    expect(r.marginRatio).toBeCloseTo(0.7);
  });

  it("allocates cost by gallons and sums exactly", () => {
    const m = allocateCostByGallons(1000, [
      { id: "a", gallons: 1 },
      { id: "b", gallons: 1 },
      { id: "c", gallons: 1 },
    ]);
    expect([...m.values()].reduce((a, b) => a + b, 0)).toBe(1000);
  });
});
