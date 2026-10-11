"use server";

import { after } from "next/server";
import { z } from "zod";
import { assertSignedIn } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";
import { changePassword, disableMfa, requestEmailChange } from "@/server/services/auth";
import { markRead, NOTIFICATION_TYPES, type NotificationType } from "@/server/services/notifications";
import { badRequest } from "@/server/errors";

/** Account-level actions shared by every portal. All operate on the signed-in user only. */

const _profile = formAction(z.object({ name: z.string().trim().min(2).max(120), phone: z.string().trim().max(40).regex(/^[\d+().\-\s x]*$/, "Use digits and + ( ) - only.").optional() }), async (input) => {
  const actor = await assertSignedIn();
  await prisma.user.update({ where: { id: actor.userId }, data: { name: input.name, phone: input.phone || null } });
  await audit(prisma, { actorId: actor.userId, action: "user.profile_update", entityType: "User", entityId: actor.userId, after: input });
  return { ok: true, message: "Profile updated." };
});
export async function updateProfileAction(prev: ActionResult, fd: FormData) {
  return _profile(prev, fd);
}

const _password = formAction(
  z.object({ current: z.string().min(1, "Enter your current password."), next: z.string().min(1), confirm: z.string().min(1) }).refine((v) => v.next === v.confirm, { message: "Passwords do not match.", path: ["confirm"] }),
  async (input) => {
    const actor = await assertSignedIn();
    await changePassword(actor, input.current, input.next);
    return { ok: true, message: "Password changed. Other sessions were signed out." };
  },
);
export async function changePasswordAction(prev: ActionResult, fd: FormData) {
  return _password(prev, fd);
}

const _email = formAction(z.object({ email: z.string().trim().toLowerCase().email() }), async (input) => {
  const actor = await assertSignedIn();
  const res = await requestEmailChange(actor, input.email);
  if (res.status === "skipped") return { ok: true, message: "Verification requested, but email delivery is not configured yet. Contact an administrator." };
  if (res.status === "failed") throw badRequest("We couldn't send the verification email. Try again later.");
  return { ok: true, message: `We sent a verification link to ${input.email}.` };
});
export async function requestEmailChangeAction(prev: ActionResult, fd: FormData) {
  return _email(prev, fd);
}

const _disableMfa = formAction(z.object({ password: z.string().min(1) }), async (input) => {
  const actor = await assertSignedIn();
  await disableMfa(actor, input.password);
  return { ok: true, message: "Two-factor authentication disabled." };
});
export async function disableMfaAction(prev: ActionResult, fd: FormData) {
  return _disableMfa(prev, fd);
}

export async function savePreferencesAction(prev: ActionResult, fd: FormData): Promise<ActionResult> {
  return runAction(async () => {
    const actor = await assertSignedIn();
    const types = Object.keys(NOTIFICATION_TYPES) as NotificationType[];
    for (const type of types) {
      if (!fd.has(`present:${type}`)) continue;
      const data = { inApp: true, email: fd.get(`email:${type}`) === "on", sms: fd.get(`sms:${type}`) === "on" };
      await prisma.notificationPreference.upsert({ where: { userId_type: { userId: actor.userId, type } }, create: { userId: actor.userId, type, ...data }, update: data });
    }
    return null;
  }).then((r) => (r.ok ? { ok: true, message: "Notification preferences saved." } : r));
}

export async function markNotificationsReadAction(ids: string[] | "all") {
  return runAction(async () => {
    const actor = await assertSignedIn();
    await markRead(actor.userId, ids);
    return null;
  });
}

export async function signOutOtherSessionsAction() {
  return runAction(async () => {
    const actor = await assertSignedIn();
    const { count } = await prisma.session.deleteMany({ where: { userId: actor.userId, id: { not: actor.sessionId } } });
    after(() => undefined);
    return count;
  });
}
