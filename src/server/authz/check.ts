import type { Actor } from "../auth/session";
import { forbidden } from "../errors";
import type { Permission } from "./permissions";

/** Pure permission checks (no Next.js imports) used by the service layer. */
export function hasPermission(actor: Actor, permission: Permission) {
  return actor.kind === "STAFF" && actor.permissions.has(permission);
}

export function assertStaffActor(actor: Actor, permission?: Permission | Permission[]): Actor {
  if (actor.kind !== "STAFF") throw forbidden();
  const perms = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (perms.length && !perms.some((p) => actor.permissions.has(p))) throw forbidden();
  return actor;
}

export function assertDriverActor(actor: Actor): Actor & { driverId: string } {
  if (actor.kind !== "DRIVER" || !actor.driverId || !actor.permissions.has("driver.portal")) throw forbidden();
  return actor as Actor & { driverId: string };
}
