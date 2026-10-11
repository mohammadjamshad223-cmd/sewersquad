import "server-only";
import { redirect } from "next/navigation";
import { getActor, type Actor } from "../auth/session";
import { forbidden, unauthenticated } from "../errors";
import type { Permission } from "./permissions";
import { assertDriverActor, assertStaffActor, hasPermission } from "./check";
export { assertDriverActor, assertStaffActor, hasPermission };

function mfaGate(actor: Actor): string | null {
  if (actor.mfaEnrollmentRequired) return "/mfa/setup";
  if (actor.mfaEnabled && !actor.mfaVerified) return "/mfa/verify";
  return null;
}

// ── Page guards (redirect) ───────────────────────────────────────────────────

export async function requireSignedIn(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) redirect("/login");
  const gate = mfaGate(actor);
  if (gate) redirect(gate);
  return actor;
}

export async function requireStaffPage(permission?: Permission | Permission[]): Promise<Actor> {
  const actor = await requireSignedIn();
  if (actor.kind !== "STAFF") redirect("/");
  const perms = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (perms.length && !perms.some((p) => actor.permissions.has(p))) redirect("/403");
  return actor;
}

export async function requireDriverPage(): Promise<Actor & { driverId: string }> {
  const actor = await requireSignedIn();
  if (actor.kind !== "DRIVER" || !actor.driverId || !actor.permissions.has("driver.portal")) redirect("/");
  return actor as Actor & { driverId: string };
}

export async function requireCustomerPage(): Promise<Actor> {
  const actor = await requireSignedIn();
  if (actor.kind !== "CUSTOMER") redirect("/");
  return actor;
}

// ── Action / API guards (throw) ──────────────────────────────────────────────

export async function assertSignedIn(): Promise<Actor> {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  if (mfaGate(actor)) throw forbidden("Multi-factor authentication is required.");
  return actor;
}

export async function assertStaff(permission?: Permission | Permission[]): Promise<Actor> {
  const actor = await assertSignedIn();
  return assertStaffActor(actor, permission);
}

export async function assertDriver(): Promise<Actor & { driverId: string }> {
  const actor = await assertSignedIn();
  return assertDriverActor(actor);
}


export async function assertCustomer(): Promise<Actor> {
  const actor = await assertSignedIn();
  if (actor.kind !== "CUSTOMER") throw forbidden();
  return actor;
}
