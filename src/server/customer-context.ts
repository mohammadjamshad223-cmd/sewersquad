import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { requireCustomerPage } from "./authz/guards";
import { customerScopeFor, effectiveLocationIds } from "./authz/scope";
import { getSetting } from "./services/settings";

export const LOCATION_COOKIE = "ss_loc";

/** Per-request customer context: actor, permitted scope, and the active location filter. */
export const customerContext = cache(async () => {
  const actor = await requireCustomerPage();
  const scope = await customerScopeFor(actor);
  const raw = (await cookies()).get(LOCATION_COOKIE)?.value ?? null;
  const selectedLocationId = raw && scope.locationIds.includes(raw) ? raw : scope.locationIds.length === 1 ? scope.locationIds[0]! : null;
  const access = await getSetting("customerAccess");
  return {
    actor,
    scope,
    selectedLocationId,
    locationIds: effectiveLocationIds(scope, selectedLocationId),
    selectedLocation: scope.locations.find((l) => l.id === selectedLocationId) ?? null,
    access,
  };
});
