"use server";

import { after } from "next/server";
import { assertStaff } from "@/server/authz/guards";
import { runAction, type ActionResult } from "@/server/action";
import { createCustomerWithService, newCustomerSchema } from "@/server/services/onboarding";
import { processDueDeliveries } from "@/server/services/notifications";

/** New Customer window: one call creates the customer, contact, locations and their first service. */
export async function createCustomerWithServiceAction(data: unknown): Promise<ActionResult<{ organizationId: string; scheduled: { location: string; jobType: string; date: string }[] }>> {
  const parsed = newCustomerSchema.safeParse(data);
  if (!parsed.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors };
  }
  return runAction(async () => {
    const actor = await assertStaff(["customers.write"]);
    const res = await createCustomerWithService(actor, parsed.data);
    after(() => processDueDeliveries());
    return res;
  });
}
