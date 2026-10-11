import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, customer, driver, job, expectCode, actorFor, PNG } from "./helpers";
import { attachJobFiles, authorizeDocument } from "@/server/services/documents";
import { setStaffFieldProfile } from "@/server/services/fleet";
import { assertDriverActor, canUseFieldPortal } from "@/server/authz/check";
import { assignJob, driverTransition } from "@/server/services/jobs";
import { customerJob } from "@/server/services/customer-portal";

describe("owner-operator: field mode & office uploads", () => {
  let A: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    A = await org("Owner Ops Co", { locations: 1 });
  });

  it("a staff member with field mode can be assigned jobs and use the driver workflow", async () => {
    const owner = await staff("super_admin");
    expect(canUseFieldPortal(owner)).toBe(false);
    const dispatcher = await staff("dispatcher");
    await expectCode(setStaffFieldProfile(dispatcher, owner.userId, true), "FORBIDDEN");

    await setStaffFieldProfile(owner, owner.userId, true);
    const fieldOwner = await actorFor(owner.userId);
    expect(fieldOwner.driverId).toBeTruthy();
    expect(assertDriverActor(fieldOwner).driverId).toBe(fieldOwner.driverId);

    const { vehicle } = await driver();
    const j = await job(A.locations[0]!.id);
    await assignJob(owner, j.id, fieldOwner.driverId!, vehicle.id);
    await driverTransition(fieldOwner, j.id, "EN_ROUTE");
    expect((await prisma.job.findUniqueOrThrow({ where: { id: j.id } })).status).toBe("EN_ROUTE");

    // Can't switch field mode off while holding open jobs; history is kept when it is switched off.
    await expectCode(setStaffFieldProfile(owner, owner.userId, false), "BAD_REQUEST");
    await prisma.job.update({ where: { id: j.id }, data: { status: "CANCELLED" } });
    await setStaffFieldProfile(owner, owner.userId, false);
    expect(canUseFieldPortal(await actorFor(owner.userId))).toBe(false);
    expect(await prisma.driver.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it("office uploads attach to the job with the right customer visibility", async () => {
    const admin = await staff("admin");
    const cust = await customer(A.org.id, "ORG_ADMIN");
    const D = await driver();
    const open = await job(A.locations[0]!.id, { driverId: D.driver.id, vehicleId: D.vehicle.id, status: "ARRIVED" });
    await expectCode(attachJobFiles(D.actor, open.id, { kind: "AFTER", visibleToCustomer: true }, [{ bytes: PNG, name: "a.png" }]), "FORBIDDEN");

    // Photos on an unapproved job stay internal until approval publishes them.
    const [photo] = await attachJobFiles(admin, open.id, { kind: "AFTER", visibleToCustomer: true }, [{ bytes: PNG, name: "a.png" }]);
    expect(photo!.visibility).toBe("INTERNAL");
    await expectCode(attachJobFiles(admin, open.id, { kind: "BEFORE", visibleToCustomer: true }, [{ bytes: new TextEncoder().encode("%PDF-1.4 x"), name: "x.pdf" }]), "BAD_REQUEST");

    const done = await job(A.locations[0]!.id);
    await prisma.job.update({ where: { id: done.id }, data: { status: "COMPLETED" } });
    const [report] = await attachJobFiles(admin, done.id, { kind: "DOCUMENT", title: "City inspection", visibleToCustomer: true }, [{ bytes: PNG, name: "r.png" }]);
    const [internal] = await attachJobFiles(admin, done.id, { kind: "DOCUMENT", title: "Internal note", visibleToCustomer: false }, [{ bytes: PNG, name: "n.png" }]);
    const [scan] = await attachJobFiles(admin, done.id, { kind: "MANIFEST", visibleToCustomer: true }, [{ bytes: PNG, name: "m.png" }]);
    expect(scan!.manifestId).toBeTruthy();

    await expect(authorizeDocument(cust, report!.id)).resolves.toBeTruthy();
    await expectCode(authorizeDocument(cust, internal!.id), "NOT_FOUND");
    const seen = await customerJob([A.locations[0]!.id], done.id);
    expect(seen.documents.map((d) => d.id)).toEqual([report!.id]);
    expect(seen.manifest?.documents.map((d) => d.id)).toContain(scan!.id);
    expect(await prisma.auditLog.count({ where: { action: "job.files_attached", entityId: done.id } })).toBe(3);
  });
});
