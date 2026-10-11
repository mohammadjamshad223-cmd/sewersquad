import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, customer, driver, expectCode } from "./helpers";
import { submitEmergency, acknowledgeEmergency, dispatchEmergency, confirmEmergencyTerms } from "@/server/services/emergencies";
import { createTicket, getTicketForCustomer, staffReply } from "@/server/services/support";
import { issueAuthToken, consumeAuthToken } from "@/server/auth/tokens";
import { hashPassword } from "@/server/auth/password";
import { login, requestPasswordReset, resetPassword } from "@/server/services/auth";
import { detectFileType } from "@/server/storage/file-validation";

describe("emergency requests", () => {
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
  });

  it("creates a numbered request, alerts dispatch, and cannot dispatch before customer approval", async () => {
    const dispatcher = await staff("dispatcher");
    const A = await org("ER Co", { locations: 1 });
    const mgr = await customer(A.org.id, "LOCATION_MANAGER", [A.locations[0]!.id]);
    const er = await submitEmergency(mgr, { locationId: A.locations[0]!.id, contactName: "Sam", contactPhone: "713-555-0101", preferredContact: "PHONE", serviceType: "INTERCEPTOR_PUMPING", category: "TRAP_OVERFLOWING", severity: "URGENT", description: "Overflowing into the kitchen", requestedTiming: "ASAP" }, []);
    expect(er.requestNumber).toMatch(/^ER-\d{4}-\d{5}$/);
    expect(await prisma.notification.count({ where: { userId: dispatcher.userId, type: "admin.emergency" } })).toBe(1);
    expect(er.confirmedArrival).toBeNull(); // nothing promised on submission
    await acknowledgeEmergency(dispatcher, er.id);
    const D = await driver();
    await expectCode(dispatchEmergency(dispatcher, er.id, { driverId: D.driver.id, vehicleId: D.vehicle.id, assetIds: [] }), "BAD_REQUEST");
    await confirmEmergencyTerms(dispatcher, er.id, { confirmedPrice: "450.00", customerApproved: true });
    const job = await dispatchEmergency(dispatcher, er.id, { driverId: D.driver.id, vehicleId: D.vehicle.id, assetIds: [A.locations[0]!.asset.id] });
    expect(job.type).toBe("EMERGENCY");
    expect(job.quotedPriceCents).toBe(45_000);
    expect((await prisma.emergencyRequest.findUniqueOrThrow({ where: { id: er.id } })).status).toBe("DISPATCHED");
  });

  it("customers cannot file requests for locations outside their scope", async () => {
    const A = await org("Scope Co", { locations: 2 });
    const mgr = await customer(A.org.id, "LOCATION_MANAGER", [A.locations[0]!.id]);
    await expectCode(submitEmergency(mgr, { locationId: A.locations[1]!.id, contactName: "Sam", contactPhone: "713-555-0101", preferredContact: "PHONE", serviceType: "INTERCEPTOR_PUMPING", category: "OTHER", severity: "HIGH", description: "Not my location at all", requestedTiming: "ASAP" }, []), "NOT_FOUND");
  });

  it("internal support notes are never returned to customers", async () => {
    const agent = await staff("admin");
    const A = await org("Support Co", { locations: 1 });
    const c = await customer(A.org.id, "ORG_ADMIN");
    const t = await createTicket(c, { category: "BILLING", subject: "Rate question", body: "What is my rate?" }, []);
    await staffReply(agent, t.id, { body: "Customer is disputing — check contract", internal: true });
    await staffReply(agent, t.id, { body: "Your rate is $0.30/gal.", internal: false });
    const visible = await getTicketForCustomer(c, t.id);
    expect(visible.messages.map((m) => m.body)).toEqual(["What is my rate?", "Your rate is $0.30/gal."]);
  });
});

describe("authentication", () => {
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
  });

  it("tokens are single-use and expire", async () => {
    const u = await prisma.user.create({ data: { email: "tok@t.test", name: "T", kind: "CUSTOMER", status: "ACTIVE" } });
    const raw = await issueAuthToken(prisma, u.id, u.email, "PASSWORD_RESET");
    expect(await consumeAuthToken(prisma, raw, "INVITATION")).toBeNull(); // wrong type
    expect(await consumeAuthToken(prisma, raw, "PASSWORD_RESET")).not.toBeNull();
    expect(await consumeAuthToken(prisma, raw, "PASSWORD_RESET")).toBeNull(); // reused
    const stale = await issueAuthToken(prisma, u.id, u.email, "PASSWORD_RESET");
    await prisma.authToken.updateMany({ where: { userId: u.id, usedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await consumeAuthToken(prisma, stale, "PASSWORD_RESET")).toBeNull();
  });

  it("locks the account after repeated failed logins and uses one generic error", async () => {
    await prisma.user.create({ data: { email: "lock@t.test", name: "L", kind: "CUSTOMER", status: "ACTIVE", passwordHash: await hashPassword("Correct-horse-1") } });
    const meta = { ip: "10.0.0.9", userAgent: null };
    for (let i = 0; i < 5; i++) await expect(login("lock@t.test", "wrong-password-1", meta)).rejects.toThrow("Incorrect email or password.");
    await expect(login("lock@t.test", "Correct-horse-1", meta)).rejects.toThrow(/temporarily locked/);
    await expect(login("nobody@t.test", "whatever-123", meta)).rejects.toThrow("Incorrect email or password.");
  });

  it("deactivated users cannot sign in; password reset revokes sessions", async () => {
    const u = await prisma.user.create({ data: { email: "reset@t.test", name: "R", kind: "CUSTOMER", status: "ACTIVE", passwordHash: await hashPassword("Old-password-1") } });
    await prisma.session.create({ data: { id: "s-reset", userId: u.id, expiresAt: new Date(Date.now() + 3600_000) } });
    await requestPasswordReset("reset@t.test", "10.0.0.10");
    const raw = await issueAuthToken(prisma, u.id, u.email, "PASSWORD_RESET");
    await resetPassword(raw, "New-password-22", "10.0.0.10");
    expect(await prisma.session.count({ where: { userId: u.id } })).toBe(0);
    await prisma.user.update({ where: { id: u.id }, data: { status: "DEACTIVATED" } });
    await expect(login("reset@t.test", "New-password-22", { ip: "10.0.0.11", userAgent: null })).rejects.toThrow(/not active/);
  });

  it("rejects uploads by content, not by name", () => {
    const html = new TextEncoder().encode("<html><script>alert(1)</script></html>");
    expect(detectFileType(html, "manifest.pdf")).toBeNull();
    expect(detectFileType(html, "notes.txt")).toBeNull();
    expect(detectFileType(new TextEncoder().encode("%PDF-1.7 ..."), "anything.bin")?.mime).toBe("application/pdf");
    expect(detectFileType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"), "logo.svg")).toBeNull();
  });

  it("the audit log is append-only at the database level", async () => {
    const row = await prisma.auditLog.create({ data: { action: "test", entityType: "X", entityId: "1" } });
    await expect(prisma.auditLog.update({ where: { id: row.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/append-only/);
  });
});

describe("staff-issued access links", () => {
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
  });

  it("resends invitations or issues reset links under user-management permissions", async () => {
    const { sendAccessLink } = await import("@/server/services/auth");
    const admin = await staff("admin");
    const dispatcher = await staff("dispatcher");
    const owner = await staff("super_admin");
    const A = await org("Link Co", { locations: 1 });
    const cust = await customer(A.org.id, "ORG_ADMIN", []);
    await prisma.user.update({ where: { id: cust.userId }, data: { passwordHash: await hashPassword("Old-password-1") } });

    // Email isn't configured in tests, so the link comes back to the staff member.
    const res = await sendAccessLink(admin, cust.userId);
    const link = (res as { data?: { inviteLink?: string } }).data?.inviteLink ?? "";
    expect(link).toMatch(/\/reset-password\?token=/);
    const token = decodeURIComponent(link.split("token=")[1]!);
    await resetPassword(token, "New-password-22", "127.0.0.1");
    expect((await login(cust.email, "New-password-22", { ip: "127.0.0.1", userAgent: null })).status).toBe("ok");
    expect(await prisma.auditLog.count({ where: { action: "user.password_reset_sent", entityId: cust.userId } })).toBe(1);

    const invited = await prisma.user.create({ data: { email: "invited@t.test", name: "Invited", kind: "STAFF", status: "INVITED", roleId: (await prisma.role.findUniqueOrThrow({ where: { key: "dispatcher" } })).id } });
    await expectCode(sendAccessLink(admin, invited.id), "FORBIDDEN"); // staff accounts need staff.manage
    const inv = await sendAccessLink(owner, invited.id);
    expect((inv as { data?: { inviteLink?: string } }).data?.inviteLink).toMatch(/\/invite\/accept\?token=/);

    await expectCode(sendAccessLink(dispatcher, cust.userId), "FORBIDDEN"); // no customers.users
    await expectCode(sendAccessLink(admin, owner.userId), "FORBIDDEN"); // only a super admin can reset a super admin
    await expectCode(sendAccessLink(owner, owner.userId), "BAD_REQUEST"); // own account uses Forgot password
  });
});
