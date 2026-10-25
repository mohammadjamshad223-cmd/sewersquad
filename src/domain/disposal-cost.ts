/**
 * Whether a service hauls waste to a disposal site. Hydro jetting, line snaking/cleaning and
 * inspections don't, so they never carry a dumping cost in profit figures.
 */
export const NON_HAULING_SERVICE_TYPES = ["HYDRO_JETTING", "LINE_CLEANING", "INSPECTION"] as const;

export function haulsWaste(serviceType: string | null | undefined, serviceTitle?: string | null): boolean {
  if (serviceType) return !(NON_HAULING_SERVICE_TYPES as readonly string[]).includes(serviceType);
  const t = (serviceTitle ?? "").toLowerCase();
  if (/pump|trap|septic|interceptor|waste|lift/.test(t)) return true;
  return !/jett|snak|inspection|line clean/.test(t);
}

/** "17.5" (cents per gallon) × gallons → whole cents. */
export function disposalCostCents(gallons: number, centsPerGallon: number) {
  return Math.round(gallons * centsPerGallon);
}
