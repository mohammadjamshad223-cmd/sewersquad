import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, customer, driver, job, sentInvoice, expectCode, PNG } from "./helpers";
import { customerScopeFor, buildCustomerScope } from "@/server/authz/scope";
import { customerInvoice, customerJob, customerInvoices } from "@/server/services/customer-portal";
import { authorizeDocument, storeDocument } from "@/server/services/documents";
import { driverJob } from "@/server/services/driver-portal";
import { createInvoice } from "@/server/services/invoices";
import { createCheckout } from "@/server/services/payments";
import { driverTransition, assignJob } from "@/server/services/jobs";
import { inviteUser } from "@/server/services/auth";
import { updateOrganization } from "@/server/services/customers";

describe("authorization & data isolation", () => {
  let A: Awaited<ReturnType<typeof org>>, B: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    A = await org("Alpha Foods");
    B = await org("Bravo Diner");
  });

  it("a customer cannot read another organization's invoice, job or document by ID", async () => {
    const alphaAdmin = await customer(A.org.id, "ORG_ADMIN");
    const scope = await buildCustomerScope(alphaAdmin);
    const bInvoice = await sentInvoice(B.org.id, B.locations[0]!.id, 10_000);
    const bJob = await job(B.locations[0]!.id);
    const bDoc = await storeDocument(prisma, { bytes: PNG, fileName: "x.png", type: "CONTRACT", visibility: "CUSTOMER", organizationId: B.org.id, locationId: B.locations[0]!.id, uploadedById: null, trusted: { mime: "image/png", ext: "png" } });
    await expectCode(customerInvoice(scope, bInvoice.id), "NOT_FOUND");
    await expectCode(customerJob(scope.locationIds, bJob.id), "NOT_FOUND");
    await expectCode(authorizeDocument(alphaAdmin, bDoc.id), "NOT_FOUND");
  });

  it("location managers only see their assigned locations", async () => {
    const mgr = await customer(A.org.id, "LOCATION_MANAGER", [A.locations[0]!.id]);
    const scope = await buildCustomerScope(mgr);
    expect(scope.locationIds).toEqual([A.locations[0]!.id]);
    const other = await sentInvoice(A.org.id, A.locations[1]!.id, 5_000);
    const mine = await sentInvoice(A.org.id, A.locations[0]!.id, 7_000);
    await expectCode(customerInvoice(scope, other.id), "NOT_FOUND");
    await expect(customerInvoice(scope, mine.id)).resolves.toMatchObject({ id: mine.id });
    const otherJob = await job(A.locations[1]!.id);
    await expectCode(customerJob(scope.locationIds, otherJob.id), "NOT_FOUND");
  });

  it("consolidated (account-level) invoices are visible to org admins only", async () => {
    const consolidated = await sentInvoice(A.org.id, null, 12_000);
    const admin = await customer(A.org.id, "ORG_ADMIN");
    const mgr = await customer(A.org.id, "LOCATION_MANAGER", [A.locations[0]!.id]);
    await expect(customerInvoice(await buildCustomerScope(admin), consolidated.id)).resolves.toBeTruthy();
    await expectCode(customerInvoice(await buildCustomerScope(mgr), consolidated.id), "NOT_FOUND");
  });

  it("draft invoices and internal documents are never visible to customers", async () => {
    const admin = await customer(A.org.id, "ORG_ADMIN");
    const draft = await sentInvoice(A.org.id, A.locations[0]!.id, 3_000, { status: "DRAFT" });
    await expectCode(customerInvoice(await customerScopeFor(admin), draft.id), "NOT_FOUND");
    const list = await customerInvoices(await buildCustomerScope(admin), null, { page: 1 });
    expect(list.items.some((i) => i.id === draft.id)).toBe(false);
    const internal = await storeDocument(prisma, { bytes: PNG, fileName: "i.png", type: "OTHER", visibility: "INTERNAL", organizationId: A.org.id, locationId: A.locations[0]!.id, uploadedById: null, trusted: { mime: "image/png", ext: "png" } });
    await expectCode(authorizeDocument(admin, internal.id), "NOT_FOUND");
  });

  it("a stray LocationMembership without an org membership grants nothing", async () => {
    const outsider = await customer(B.org.id, "LOCATION_MANAGER", [B.locations[0]!.id]);
    await prisma.locationMembership.create({ data: { userId: outsider.userId, locationId: A.locations[0]!.id } });
    const { loadActorBySessionId } = await import("@/server/auth/session");
    const s = await prisma.session.findFirstOrThrow({ where: { userId: outsider.userId } });
    const refreshed = (await loadActorBySessionId(s.id))!;
    const scope = await buildCustomerScope(refreshed);
    expect(scope.locationIds).not.toContain(A.locations[0]!.id);
  });

  it("drivers can only access jobs assigned to them", async () => {
    const d1 = await driver();
    const d2 = await driver();
    const j = await job(A.locations[0]!.id, { driverId: d1.driver.id, vehicleId: d1.vehicle.id, assetId: A.locations[0]!.asset.id });
    await expect(driverJob(d1.driver.id, j.id)).resolves.toBeTruthy();
    await expectCode(driverJob(d2.driver.id, j.id), "NOT_FOUND");
    await expectCode(driverTransition(d2.actor, j.id, "EN_ROUTE"), "NOT_FOUND");
    const photo = await storeDocument(prisma, { bytes: PNG, fileName: "p.png", type: "SERVICE_PHOTO", organizationId: A.org.id, locationId: A.locations[0]!.id, jobId: j.id, uploadedById: d1.actor.userId, trusted: { mime: "image/png", ext: "png" } });
    await expect(authorizeDocument(d1.actor, photo.id)).resolves.toBeTruthy();
    await expectCode(authorizeDocument(d2.actor, photo.id), "NOT_FOUND");
  });

  it("staff permissions are enforced in the service layer, not just the UI", async () => {
    const dispatcher = await staff("dispatcher");
    const accounting = await staff("accounting");
    await expectCode(createInvoice(dispatcher, { organizationId: A.org.id, lines: [{ kind: "SERVICE", description: "x", quantity: "1", unitPrice: "10", taxable: true }] }), "FORBIDDEN");
    const j = await job(A.locations[0]!.id);
    await expectCode(assignJob(accounting, j.id, null, null), "FORBIDDEN");
    await expectCode(updateOrganization(accounting, A.org.id, { name: "Hacked", type: "RESTAURANT", billingMode: "CONSOLIDATED", primaryEmail: null, primaryPhone: null, website: null, notes: null, accountRepId: null }), "FORBIDDEN");
  });

  it("customers and drivers cannot use staff services; only super admins grant super admin", async () => {
    const cust = await customer(A.org.id, "ORG_ADMIN");
    const d = await driver();
    await expectCode(createInvoice(cust, { organizationId: A.org.id, lines: [{ kind: "SERVICE", description: "x", quantity: "1", unitPrice: "10", taxable: true }] }), "FORBIDDEN");
    await expectCode(assignJob(d.actor, (await job(A.locations[0]!.id)).id, null, null), "FORBIDDEN");
    const admin = await staff("admin");
    await expectCode(inviteUser(admin, { kind: "STAFF", email: "x@t.test", name: "X", roleKey: "super_admin" }), "FORBIDDEN");
    await expectCode(inviteUser(cust, { kind: "CUSTOMER", email: "y@t.test", name: "Y", organizationId: A.org.id, orgRole: "ORG_ADMIN" }), "FORBIDDEN");
  });

  it("read-only customers cannot start a payment", async () => {
    const ro = await customer(A.org.id, "READ_ONLY", [A.locations[0]!.id]);
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 2_500);
    await expectCode(createCheckout(ro, [inv.id]), "BAD_REQUEST");
  });
});
