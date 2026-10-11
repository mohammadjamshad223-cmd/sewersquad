/**
 * Truck load planning. Walks a route in stop order, adding estimated gallons per service stop
 * and emptying the tank at disposal stops; warns where the running estimate exceeds capacity.
 * Estimates only — actual loads come from recorded collections and documented disposal events.
 */
export type RouteStop =
  | { kind: "service"; id: string; label: string; estimatedGallons: number | null }
  | { kind: "disposal"; id: string; label: string };

export type CapacityResult = {
  stops: { id: string; loadAfter: number; overCapacity: boolean; missingEstimate: boolean }[];
  peakLoad: number;
  totalEstimated: number;
  warnings: string[];
  hasMissingEstimates: boolean;
};

export function planCapacity(capacityGallons: number, stops: RouteStop[], startingLoad = 0): CapacityResult {
  let load = startingLoad;
  let peak = startingLoad;
  let total = 0;
  const warnings: string[] = [];
  const out: CapacityResult["stops"] = [];
  let warnedSinceDump = false;
  for (const s of stops) {
    if (s.kind === "disposal") {
      load = 0;
      warnedSinceDump = false;
      out.push({ id: s.id, loadAfter: 0, overCapacity: false, missingEstimate: false });
      continue;
    }
    const est = s.estimatedGallons ?? 0;
    total += est;
    load += est;
    peak = Math.max(peak, load);
    const over = load > capacityGallons;
    if (over && !warnedSinceDump) {
      warnings.push(`Estimated load reaches ${load.toLocaleString()} gal at "${s.label}", exceeding the ${capacityGallons.toLocaleString()} gal tank. Add a disposal stop before this job.`);
      warnedSinceDump = true;
    }
    out.push({ id: s.id, loadAfter: load, overCapacity: over, missingEstimate: s.estimatedGallons === null });
  }
  const hasMissing = out.some((s) => s.missingEstimate);
  if (hasMissing) warnings.push("Some stops have no gallon estimate; capacity check is incomplete.");
  return { stops: out, peakLoad: peak, totalEstimated: total, warnings, hasMissingEstimates: hasMissing };
}
