"use server";

import { after } from "next/server";
import { z } from "zod";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { settingsSchemas, updateSetting, type SettingsKey } from "@/server/services/settings";
import { inviteUser, setUserActive, invitationResult } from "@/server/services/auth";
import { processDueDeliveries } from "@/server/services/notifications";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { badRequest, forbidden } from "@/server/errors";
import { ALL_PERMISSIONS, type Permission } from "@/server/authz/permissions";
import type { Prisma } from "@prisma/client";

/** Settings forms post flat fields; numbers/booleans/arrays are coerced against the section schema. */
export async function saveSettingsAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const key = String(fd.get("section")) as SettingsKey;
    if (!(key in settingsSchemas)) throw badRequest("Unknown settings section.");
    const actor = await assertStaff("settings.write");
    const shape = (settingsSchemas[key] as unknown as z.ZodObject<z.ZodRawShape>).shape;
    const value: Record<string, unknown> = {};
    for (const [field, schema] of Object.entries(shape)) {
      const inner = (schema as z.ZodDefault<z.ZodTypeAny>)._def.innerType ?? schema;
      const raw = fd.get(field);
      if (inner instanceof z.ZodBoolean) value[field] = raw === "on";
      else if (raw === null) continue;
      else if (inner instanceof z.ZodNumber) value[field] = Number(raw);
      else if (inner instanceof z.ZodArray) {
        const s = String(raw).trim();
        value[field] = s.startsWith("[") ? JSON.parse(s) : s.split(/[\s,]+/).filter(Boolean).map(Number);
      } else value[field] = String(raw);
    }
    await updateSetting(key, value, actor.userId);
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Settings saved." } : r));
}

const _staff = formAction(z.object({ email: z.string().trim().email(), name: z.string().trim().min(2), phone: z.string().trim().optional(), roleKey: z.enum(["super_admin", "admin", "dispatcher", "accounting"]) }), async (i) => {
  const { token } = await inviteUser(await assertStaff("staff.manage"), { kind: "STAFF", ...i });
  after(() => processDueDeliveries());
  return invitationResult(i.email, token);
});
export async function inviteStaffAction(p: ActionResult, fd: FormData) { return _staff(p, fd); }

export async function changeStaffRoleAction(userId: string, roleKey: string) {
  return runAction(async () => {
    const actor = await assertStaff("staff.manage");
    if (userId === actor.userId) throw badRequest("You cannot change your own role.");
    if (roleKey === "super_admin" && actor.roleKey !== "super_admin") throw forbidden();
    const [user, role] = await Promise.all([prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { role: true } }), prisma.role.findUniqueOrThrow({ where: { key: roleKey } })]);
    if (user.kind !== "STAFF" || roleKey === "driver") throw badRequest("Only staff roles can be assigned here.");
    if (user.role?.key === "super_admin" && actor.roleKey !== "super_admin") throw forbidden();
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { roleId: role.id } });
      await tx.session.deleteMany({ where: { userId } }); // force re-auth with new permissions (and MFA if now required)
      await audit(tx, { actorId: actor.userId, action: "permission.role_change", entityType: "User", entityId: userId, before: { role: user.role?.key }, after: { role: roleKey } });
    });
  });
}

export async function setStaffActiveAction(userId: string, active: boolean) {
  return runAction(async () => setUserActive(await assertStaff("staff.manage"), userId, active));
}

/** Edit a role's permission grants. Super admin is fixed; changes are audited. */
export async function saveRolePermissionsAction(p: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertStaff("staff.manage");
    if (actor.roleKey !== "super_admin") throw forbidden("Only super admins can change role permissions.");
    const roleKey = String(fd.get("roleKey"));
    if (roleKey === "super_admin") throw badRequest("Super admin permissions cannot be reduced.");
    const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey }, include: { permissions: { include: { permission: true } } } });
    const wanted = fd.getAll("permissions").map(String).filter((p): p is Permission => (ALL_PERMISSIONS as string[]).includes(p));
    if (roleKey === "driver" && wanted.some((p) => p !== "driver.portal")) throw badRequest("Drivers can only hold the driver portal permission.");
    if (roleKey !== "driver" && wanted.includes("driver.portal")) throw badRequest("Staff roles cannot hold the driver portal permission.");
    if (wanted.includes("staff.manage")) throw badRequest("Staff management is reserved for super admins.");
    const perms = await prisma.permission.findMany({ where: { key: { in: wanted } } });
    const before = role.permissions.map((rp) => rp.permission.key).sort();
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId: role.id, permissionId: p.id })) });
      await audit(tx, { actorId: actor.userId, action: "permission.role_update", entityType: "Role", entityId: role.id, before: { permissions: before }, after: { permissions: wanted.sort() } });
    });
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Role permissions updated." } : r));
}

const _tpl = formAction(z.object({ templateId: z.string().uuid(), name: z.string().trim().min(3), jurisdiction: z.string().trim().min(2).max(40), fieldsJson: z.string(), notes: z.string().optional(), active: z.enum(["on"]).optional() }), async (i) => {
  const actor = await assertStaff("settings.write");
  let fields: unknown;
  try {
    fields = JSON.parse(i.fieldsJson);
  } catch {
    throw badRequest("Fields must be valid JSON.");
  }
  const FieldSchema = z.array(z.object({ key: z.string().regex(/^(generator|collection|hauler|disposal|signatures|extra)\.[A-Za-z0-9_]+$/), label: z.string().min(1), section: z.string().min(1), required: z.boolean(), source: z.enum(["driver", "customer", "hauler", "disposal", "admin", "account"]) })).min(1);
  const parsed = FieldSchema.parse(fields);
  await prisma.$transaction(async (tx) => {
    const before = await tx.manifestTemplate.findUniqueOrThrow({ where: { id: i.templateId } });
    await tx.manifestTemplate.update({ where: { id: i.templateId }, data: { name: i.name, jurisdiction: i.jurisdiction, fields: parsed as unknown as Prisma.InputJsonValue, notes: i.notes ?? null, active: i.active === "on" } });
    await audit(tx, { actorId: actor.userId, action: "manifest_template.update", entityType: "ManifestTemplate", entityId: i.templateId, before: before.fields, after: parsed });
  });
  return { ok: true, message: "Template saved. New manifests use it; finalized manifests are unchanged." };
});
export async function saveTemplateAction(p: ActionResult, fd: FormData) { return _tpl(p, fd); }
