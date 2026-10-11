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

/**
 * Field (driver) portal access: driver accounts with the driver.portal permission, or staff
 * members who also work in the field (an owner-operator) and have an active driver profile.
 */
export function canUseFieldPortal(actor: Actor): actor is Actor & { driverId: string } {
  if (!actor.driverId) return false;
  if (actor.kind === "DRIVER") return actor.permissions.has("driver.portal");
  return actor.kind === "STAFF";
}

export function assertDriverActor(actor: Actor): Actor & { driverId: string } {
  if (!canUseFieldPortal(actor)) throw forbidden();
  return actor as Actor & { driverId: string };
}
