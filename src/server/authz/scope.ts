import "server-only";
import { cache } from "react";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { notFound, forbidden } from "../errors";
import { withLocationLabels } from "@/lib/location-label";
import type { Actor } from "../auth/session";

/**
 * Customer data scope.
 *
 * - ORG_ADMIN → every (non-deleted) location of that organization.
 * - LOCATION_MANAGER / READ_ONLY → only locations with an explicit LocationMembership, and only
 *   within organizations the user is a member of (a stray LocationMembership grants nothing).
 *
 * All customer-facing queries must use these predicates. Records outside scope are reported as
 * "not found" so that IDs cannot be probed.
 */
export type CustomerScope = {
  organizations: { id: string; name: string; accountNumber: string; role: Actor["memberships"][number]["role"]; canPay: boolean }[];
  locations: { id: string; name: string; organizationId: string; city: string; code: string }[];
  locationIds: string[];
  orgAdminOrgIds: string[];
  orgIds: string[];
};

export async function buildCustomerScope(actor: Actor): Promise<CustomerScope> {
  if (actor.kind !== "CUSTOMER") throw forbidden();
  const orgIds = actor.memberships.map((m) => m.organizationId);
  const orgAdminOrgIds = actor.memberships.filter((m) => m.role === "ORG_ADMIN").map((m) => m.organizationId);
  const [orgs, locations] = await Promise.all([
    prisma.organization.findMany({
      where: { id: { in: orgIds }, deletedAt: null, status: "ACTIVE" },
      select: { id: true, name: true, accountNumber: true },
      orderBy: { name: "asc" },
    }),
    prisma.serviceLocation.findMany({
      where: {
        deletedAt: null,
        organizationId: { in: orgIds },
        OR: [{ organizationId: { in: orgAdminOrgIds } }, { id: { in: actor.locationIds } }],
      },
      select: { id: true, name: true, organizationId: true, city: true, code: true, addressLine1: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    organizations: orgs.map((o) => {
      const m = actor.memberships.find((x) => x.organizationId === o.id)!;
      return { ...o, role: m.role, canPay: m.canPay };
    }),
    // Same-named locations read "Name — Street" so customers can tell them apart too.
    locations: withLocationLabels(locations).map(({ label, addressLine1: _a, ...l }) => (void _a, { ...l, name: label })),
    locationIds: locations.map((l) => l.id),
    orgAdminOrgIds: orgAdminOrgIds.filter((id) => orgs.some((o) => o.id === id)),
    orgIds: orgs.map((o) => o.id),
  };
}

export const customerScopeFor = cache(buildCustomerScope);

/** Narrow the scope to one selected location (from the location switcher), if valid. */
export function effectiveLocationIds(scope: CustomerScope, selectedLocationId?: string | null): string[] {
  if (selectedLocationId && scope.locationIds.includes(selectedLocationId)) return [selectedLocationId];
  return scope.locationIds;
}

export function assertLocationInScope(scope: CustomerScope, locationId: string) {
  if (!scope.locationIds.includes(locationId)) throw notFound();
}

export function canPayForOrg(scope: CustomerScope, organizationId: string, readOnlyCanPay: boolean) {
  const org = scope.organizations.find((o) => o.id === organizationId);
  if (!org) return false;
  if (org.role === "READ_ONLY") return readOnlyCanPay && org.canPay;
  return org.canPay;
}

export function canEditForOrg(scope: CustomerScope, organizationId: string) {
  const org = scope.organizations.find((o) => o.id === organizationId);
  return Boolean(org && org.role !== "READ_ONLY");
}

// ── Prisma predicates ────────────────────────────────────────────────────────

export function locationScopedWhere(scope: CustomerScope, selected?: string | null) {
  return { locationId: { in: effectiveLocationIds(scope, selected) } };
}

/**
 * Invoices can be location-level or consolidated (organization-level). Location managers see
 * invoices for their locations; consolidated invoices are visible to org admins only.
 */
export function invoiceScopedWhere(scope: CustomerScope, selected?: string | null): Prisma.InvoiceWhereInput {
  const ids = effectiveLocationIds(scope, selected);
  const or: Prisma.InvoiceWhereInput[] = [{ serviceLocationId: { in: ids } }, { billingLocationId: { in: ids } }];
  if (!selected || !scope.locationIds.includes(selected)) {
    or.push({ organizationId: { in: scope.orgAdminOrgIds }, serviceLocationId: null, billingLocationId: null });
  }
  return { organizationId: { in: scope.orgIds }, status: { notIn: ["DRAFT"] }, OR: or };
}

export function documentScopedWhere(scope: CustomerScope, selected?: string | null): Prisma.DocumentWhereInput {
  const ids = effectiveLocationIds(scope, selected);
  const or: Prisma.DocumentWhereInput[] = [{ locationId: { in: ids } }];
  if (!selected || !scope.locationIds.includes(selected)) {
    or.push({ organizationId: { in: scope.orgAdminOrgIds }, locationId: null });
  }
  return { deletedAt: null, visibility: "CUSTOMER", organizationId: { in: scope.orgIds }, OR: or };
}

export function paymentScopedWhere(scope: CustomerScope, selected?: string | null): Prisma.PaymentWhereInput {
  // A payment is visible when at least one of its allocations is on an invoice the user can see.
  return { organizationId: { in: scope.orgIds }, allocations: { some: { invoice: invoiceScopedWhere(scope, selected) } } };
}
