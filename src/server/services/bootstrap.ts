import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type Db } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { badRequest, forbidden } from "../errors";
import { safeEqual } from "../crypto";
import { hashPassword, passwordProblem } from "../auth/password";
import { rateLimit } from "../auth/rate-limit";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type SystemRoleKey } from "../authz/permissions";
import { DEFAULT_TEMPLATE_FIELDS } from "@/domain/manifest";

/**
 * Idempotent system data every install needs: permissions, system roles (existing grants are
 * left as configured, except Super Admin always holds every staff permission) and a default
 * manifest template when none exists. Never touches business data.
 */
export async function ensureSystemData(db: Db = prisma) {
  const created: string[] = [];
  for (const key of ALL_PERMISSIONS) {
    const { description, group } = PERMISSIONS[key];
    await db.permission.upsert({ where: { key }, update: { description, group }, create: { key, description, group } });
  }
  const perms = new Map((await db.permission.findMany()).map((p) => [p.key, p.id]));
  for (const [key, meta] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, { name: string; description: string }][]) {
    if (await db.role.findUnique({ where: { key } })) continue;
    await db.role.create({ data: { key, name: meta.name, description: meta.description, isSystem: true, permissions: { create: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ permissionId: perms.get(p)! })) } } });
    created.push(`role ${key}`);
  }
  const superAdmin = await db.role.findUniqueOrThrow({ where: { key: "super_admin" } });
  await db.rolePermission.createMany({ data: DEFAULT_ROLE_PERMISSIONS.super_admin.map((p) => ({ roleId: superAdmin.id, permissionId: perms.get(p)! })), skipDuplicates: true });

  if ((await db.manifestTemplate.count()) === 0) {
    await db.manifestTemplate.create({
      data: {
        key: "tx-default-liquid-waste",
        name: "Texas — Non-hazardous liquid waste (default)",
        jurisdiction: "TX",
        fields: DEFAULT_TEMPLATE_FIELDS as unknown as Prisma.InputJsonValue,
        isDefault: true,
        notes: "Starting template. Confirm required fields with each local authority before relying on it for compliance.",
      },
    });
    created.push("default manifest template");
  }
  return { superAdminRoleId: superAdmin.id, created };
}

async function hasSuperAdmin(db: Db = prisma) {
  return (await db.user.count({ where: { kind: "STAFF", status: { in: ["ACTIVE", "INVITED"] }, role: { key: "super_admin" } } })) > 0;
}

/** The first-run setup page exists only while SETUP_TOKEN is set and no Super Admin exists. */
export async function setupAvailable() {
  const token = env().SETUP_TOKEN;
  if (!token) return false;
  try {
    return !(await hasSuperAdmin());
  } catch {
    return false; // database not migrated yet
  }
}

/**
 * Creates the first Super Admin from the web, guarded by SETUP_TOKEN. A transaction-scoped
 * advisory lock serializes concurrent attempts so at most one account is ever created.
 */
export async function completeSetup(input: { token: string; name: string; email: string; password: string }, meta: { ip: string }) {
  await rateLimit(`setup:ip:${meta.ip}`, 10, 15 * 60);
  const expected = env().SETUP_TOKEN;
  if (!expected || !safeEqual(input.token, expected)) throw forbidden("The setup code is not correct.");
  const email = input.email.trim().toLowerCase();
  const problem = passwordProblem(input.password, email);
  if (problem) throw badRequest(problem);
  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(727271)`;
    if (await hasSuperAdmin(tx)) throw forbidden("Setup has already been completed. Sign in instead.");
    const { superAdminRoleId } = await ensureSystemData(tx);
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing) throw badRequest("That email already belongs to an account.");
    const user = await tx.user.create({ data: { email, name: input.name.trim(), kind: "STAFF", status: "ACTIVE", passwordHash, passwordChangedAt: new Date(), emailVerifiedAt: new Date(), roleId: superAdminRoleId } });
    await audit(tx, { actorId: user.id, action: "system.setup", entityType: "User", entityId: user.id, after: { email, role: "super_admin" }, ipAddress: meta.ip });
    return user;
  }, { timeout: 30_000 });
}
