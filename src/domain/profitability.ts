/**
 * Service contribution (NOT net profit): revenue minus allocated direct costs.
 * Any missing cost input marks the result as incomplete so it is never presented as final.
 */
export type ContributionInput = {
  revenueCents: number; // invoice revenue excluding sales tax
  disposalCostCents: number | null;
  laborCostCents: number | null;
  truckCostCents: number | null;
  otherCostCents?: number;
};

export type ContributionResult = {
  revenueCents: number;
  directCostCents: number;
  contributionCents: number;
  marginRatio: number | null;
  complete: boolean;
  missing: string[];
};

export function computeContribution(i: ContributionInput): ContributionResult {
  const missing: string[] = [];
  if (i.disposalCostCents === null) missing.push("disposal cost");
  if (i.laborCostCents === null) missing.push("labor cost");
  if (i.truckCostCents === null) missing.push("truck cost");
  const cost = (i.disposalCostCents ?? 0) + (i.laborCostCents ?? 0) + (i.truckCostCents ?? 0) + (i.otherCostCents ?? 0);
  const contribution = i.revenueCents - cost;
  return {
    revenueCents: i.revenueCents,
    directCostCents: cost,
    contributionCents: contribution,
    marginRatio: i.revenueCents > 0 ? contribution / i.revenueCents : null,
    complete: missing.length === 0,
    missing,
  };
}

/** Allocate a disposal event's cost to jobs proportionally to the gallons each contributed. Sums exactly. */
export function allocateCostByGallons(totalCostCents: number, shares: { id: string; gallons: number }[]): Map<string, number> {
  const totalGallons = shares.reduce((s, x) => s + x.gallons, 0);
  const out = new Map<string, number>();
  if (totalGallons === 0) {
    shares.forEach((s) => out.set(s.id, 0));
    return out;
  }
  let allocated = 0;
  shares.forEach((s, idx) => {
    const amt = idx === shares.length - 1 ? totalCostCents - allocated : Math.round((totalCostCents * s.gallons) / totalGallons);
    allocated += amt;
    out.set(s.id, amt);
  });
  return out;
}
