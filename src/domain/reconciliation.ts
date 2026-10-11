/**
 * Collected vs. disposed reconciliation.
 *
 * For a truck over a period:
 *   expectedDisposed = openingLoad + collected − closingLoad + Σ documented adjustments
 *   discrepancy      = actualDisposed − expectedDisposed
 * A discrepancy beyond tolerance is flagged as unexplained.
 */
export type ReconInput = {
  openingLoadGallons: number;
  closingLoadGallons: number;
  collectedGallons: number;
  disposedGallons: number;
  adjustmentsGallons: number;
};

export type ReconResult = ReconInput & {
  expectedDisposedGallons: number;
  discrepancyGallons: number;
  toleranceGallons: number;
  flagged: boolean;
};

export function toleranceFor(volume: number): number {
  return Math.max(25, Math.round(volume * 0.02));
}

export function reconcile(input: ReconInput): ReconResult {
  const expected = input.openingLoadGallons + input.collectedGallons - input.closingLoadGallons + input.adjustmentsGallons;
  const discrepancy = input.disposedGallons - expected;
  const tolerance = toleranceFor(Math.max(expected, input.disposedGallons));
  return { ...input, expectedDisposedGallons: expected, discrepancyGallons: discrepancy, toleranceGallons: tolerance, flagged: Math.abs(discrepancy) > tolerance };
}

/** Per-disposal-event check: discharged gallons vs. loads allocated to it. */
export function reconcileEvent(e: { gallons: number; openingLoadGallons: number | null; closingLoadGallons: number | null; adjustmentGallons: number; allocatedGallons: number }) {
  return reconcile({
    openingLoadGallons: e.openingLoadGallons ?? 0,
    closingLoadGallons: e.closingLoadGallons ?? 0,
    collectedGallons: e.allocatedGallons,
    disposedGallons: e.gallons,
    adjustmentsGallons: e.adjustmentGallons,
  });
}
