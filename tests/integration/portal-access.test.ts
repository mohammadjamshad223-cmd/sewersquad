import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, customer, sentInvoice, actorFor, expectCode } from "./helpers";
import { updatePortalAccess } from "@/server/services/customers";
import { customerScopeFor, invoiceScopedWhere } from "@/server/authz/scope";

describe("editing a portal user's access", () => {
  let admin: Awaited<ReturnType<typeof staff>>;
  let A: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    admin = await staff("admin");
    A = await org("BATE Mechanical", { locations: 2 });
  });

  const visibleInvoices = async (userId: string) => {
    const scope = await customerScopeFor(await actorFor(userId));
    return prisma.invoice.findMany({ where: invoiceScopedWhere(scope, null), select: { id: true } });
  };

  it("a location manager sees a second location's invoice once that location is added", async () => {
    const [target, willies] = A.locations;
    const willie = await customer(A.org.id, "LOCATION_MANAGER", [target!.id]);
    const inv = await sentInvoice(A.org.id, willies!.id, 50000);
    expect((await visibleInvoices(willie.userId)).map((i) => i.id)).not.toContain(inv.id);

    await updatePortalAccess(admin, A.org.id, willie.userId, { role: "LOCATION_MANAGER", canPay: true, locationIds: [target!.id, willies!.id] });
    expect((await visibleInvoices(willie.userId)).map((i) => i.id)).toContain(inv.id);

    // Removing a location takes it away again; making them an org admin shows everything.
    await updatePortalAccess(admin, A.org.id, willie.userId, { role: "LOCATION_MANAGER", canPay: false, locationIds: [target!.id] });
    expect((await visibleInvoices(willie.userId)).map((i) => i.id)).not.toContain(inv.id);
    await updatePortalAccess(admin, A.org.id, willie.userId, { role: "ORG_ADMIN", canPay: true, locationIds: [] });
    expect((await visibleInvoices(willie.userId)).map((i) => i.id)).toContain(inv.id);
    expect(await prisma.auditLog.count({ where: { action: "user.portal_access_update", entityId: willie.userId } })).toBe(3);
  });

  it("checks permissions and that locations belong to the customer", async () => {
    const someone = await customer(A.org.id, "LOCATION_MANAGER", [A.locations[0]!.id]);
    const other = await org("Other Co", { locations: 1 });
    await expectCode(updatePortalAccess(admin, A.org.id, someone.userId, { role: "LOCATION_MANAGER", canPay: true, locationIds: [other.locations[0]!.id] }), "BAD_REQUEST");
    await expectCode(updatePortalAccess(admin, A.org.id, someone.userId, { role: "LOCATION_MANAGER", canPay: true, locationIds: [] }), "BAD_REQUEST");
    await expectCode(updatePortalAccess(await staff("dispatcher"), A.org.id, someone.userId, { role: "ORG_ADMIN", canPay: true, locationIds: [] }), "FORBIDDEN");
  });
});
