import { beforeEach, describe, expect, it } from "vitest";
import { prisma, resetDb, expectCode } from "./helpers";
import { completeSetup, ensureSystemData, setupAvailable } from "@/server/services/bootstrap";

const TOKEN = process.env.SETUP_TOKEN!;
const owner = { token: TOKEN, name: "Pat Owner", email: "Owner@Example.com", password: "Correct-horse-42" };

describe("first-run setup", () => {
  beforeEach(resetDb);

  it("system data is idempotent and keeps customized role grants", async () => {
    await ensureSystemData();
    const dispatcher = await prisma.role.findUniqueOrThrow({ where: { key: "dispatcher" }, include: { permissions: true } });
    await prisma.rolePermission.delete({ where: { roleId_permissionId: { roleId: dispatcher.id, permissionId: dispatcher.permissions[0]!.permissionId } } });
    const second = await ensureSystemData();
    expect(second.created).toEqual([]);
    expect(await prisma.rolePermission.count({ where: { roleId: dispatcher.id } })).toBe(dispatcher.permissions.length - 1);
    expect(await prisma.manifestTemplate.count()).toBe(1);
  });

  it("requires the setup code and creates exactly one active Super Admin", async () => {
    expect(await setupAvailable()).toBe(true);
    await expectCode(completeSetup({ ...owner, token: "wrong-token-wrong-token" }, { ip: "1.1.1.1" }), "FORBIDDEN");
    await expectCode(completeSetup({ ...owner, password: "short" }, { ip: "1.1.1.1" }), "BAD_REQUEST");
    const user = await completeSetup(owner, { ip: "1.1.1.1" });
    expect(user).toMatchObject({ email: "owner@example.com", status: "ACTIVE", kind: "STAFF" });
    expect((await prisma.role.findUniqueOrThrow({ where: { id: user.roleId! } })).key).toBe("super_admin");
    expect(await setupAvailable()).toBe(false);
    await expectCode(completeSetup({ ...owner, email: "second@example.com" }, { ip: "1.1.1.1" }), "FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { action: "system.setup" } })).toBe(1);
  });

  it("concurrent attempts create only one account", async () => {
    const results = await Promise.allSettled([
      completeSetup({ ...owner, email: "a@example.com" }, { ip: "2.2.2.2" }),
      completeSetup({ ...owner, email: "b@example.com" }, { ip: "2.2.2.3" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { role: { key: "super_admin" } } })).toBe(1);
  });
});
