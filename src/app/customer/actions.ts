"use server";

import { cookies } from "next/headers";
import { assertCustomer } from "@/server/authz/guards";
import { customerScopeFor } from "@/server/authz/scope";
import { LOCATION_COOKIE } from "@/server/customer-context";
import { env } from "@/server/env";
import { runAction } from "@/server/action";
import { notFound } from "@/server/errors";

export async function selectLocationAction(locationId: string | null) {
  return runAction(async () => {
    const actor = await assertCustomer();
    const scope = await customerScopeFor(actor);
    const jar = await cookies();
    if (!locationId) {
      jar.delete(LOCATION_COOKIE);
      return null;
    }
    if (!scope.locationIds.includes(locationId)) throw notFound();
    jar.set(LOCATION_COOKIE, locationId, { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    return locationId;
  });
}
