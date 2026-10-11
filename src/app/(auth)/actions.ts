"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { after } from "next/server";
import { z } from "zod";
import { formAction, type ActionResult } from "@/server/action";
import { requestMeta } from "@/server/auth/request";
import * as auth from "@/server/services/auth";
import { destroyCurrentSession, getActor, homePathFor } from "@/server/auth/session";
import { processDueDeliveries } from "@/server/services/notifications";
import { badRequest, unauthenticated } from "@/server/errors";
import { env } from "@/server/env";

const email = z.string().trim().toLowerCase().email("Enter a valid email address.");

function safeNext(next: unknown): string | null {
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : null;
}

const _loginAction = formAction(z.object({ email, password: z.string().min(1, "Enter your password."), next: z.string().optional() }), async (input) => {
  const meta = await requestMeta();
  const res = await auth.login(input.email, input.password, meta);
  if (res.status === "mfa_required") redirect("/mfa/verify");
  if (res.status === "mfa_setup_required") redirect("/mfa/setup");
  redirect(safeNext(input.next) ?? homePathFor(res));
});

export async function logoutAction() {
  await destroyCurrentSession();
  redirect("/login");
}

const _forgotPasswordAction = formAction(z.object({ email }), async (input): Promise<ActionResult> => {
  const { ip } = await requestMeta();
  await auth.requestPasswordReset(input.email, ip);
  after(() => processDueDeliveries());
  return { ok: true, message: "If an account exists for that email, a reset link is on its way." };
});

const _resetPasswordAction = formAction(
  z
    .object({ token: z.string().min(10), password: z.string().min(1), confirm: z.string().min(1) })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] }),
  async (input) => {
    const { ip } = await requestMeta();
    await auth.resetPassword(input.token, input.password, ip);
    redirect("/login?reset=1");
  },
);

const _acceptInviteAction = formAction(
  z
    .object({ token: z.string().min(10), password: z.string().min(1), confirm: z.string().min(1) })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] }),
  async (input) => {
    const meta = await requestMeta();
    const user = await auth.acceptInvitation(input.token, input.password, meta);
    const { isPrivilegedRole } = await import("@/server/auth/session");
    if (env().REQUIRE_ADMIN_MFA === "true" && isPrivilegedRole(user.role?.key)) redirect("/mfa/setup");
    redirect(homePathFor(user));
  },
);

const MFA_COOKIE = "ss_mfa_pending";

export async function beginMfaSetupAction(): Promise<{ uri: string; base32: string; qrSvg: string }> {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  if (actor.mfaEnabled) throw badRequest("MFA is already enabled.");
  const { uri, base32, enc } = auth.beginMfaEnrollment(actor.email);
  (await cookies()).set(MFA_COOKIE, enc, { httpOnly: true, sameSite: "strict", secure: env().NODE_ENV === "production", path: "/", maxAge: 600 });
  const QR = await import("qrcode");
  const qrSvg = await QR.toString(uri, { type: "svg", margin: 1, width: 180 });
  return { uri, base32, qrSvg };
}

const _completeMfaSetupAction = formAction(z.object({ code: z.string().trim().min(6) }), async (input): Promise<ActionResult<{ codes: string[] }>> => {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  const jar = await cookies();
  const pending = jar.get(MFA_COOKIE)?.value;
  if (!pending) throw badRequest("Setup expired. Reload the page to start again.");
  const codes = await auth.completeMfaEnrollment(actor, pending, input.code);
  jar.delete(MFA_COOKIE);
  return { ok: true, message: "Two-factor authentication is on.", data: { codes } };
});

const _verifyMfaAction = formAction(z.object({ code: z.string().trim().min(6) }), async (input) => {
  const actor = await getActor();
  if (!actor) throw unauthenticated();
  await auth.verifyMfaForSession(actor, input.code);
  redirect(homePathFor(actor));
});

// Exported server actions must be literal async functions.
export async function loginAction(prev: ActionResult, fd: FormData) {
  return _loginAction(prev, fd);
}
export async function forgotPasswordAction(prev: ActionResult, fd: FormData) {
  return _forgotPasswordAction(prev, fd);
}
export async function resetPasswordAction(prev: ActionResult, fd: FormData) {
  return _resetPasswordAction(prev, fd);
}
export async function acceptInviteAction(prev: ActionResult, fd: FormData) {
  return _acceptInviteAction(prev, fd);
}
export async function completeMfaSetupAction(prev: ActionResult, fd: FormData) {
  return _completeMfaSetupAction(prev, fd);
}
export async function verifyMfaAction(prev: ActionResult, fd: FormData) {
  return _verifyMfaAction(prev, fd);
}

const _setupAction = formAction(
  z
    .object({ token: z.string().min(1, "Enter the setup code."), name: z.string().trim().min(2, "Enter your name."), email, password: z.string().min(1), confirm: z.string().min(1) })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] }),
  async (input) => {
    const meta = await requestMeta();
    const { completeSetup } = await import("@/server/services/bootstrap");
    const { createSession } = await import("@/server/auth/session");
    const user = await completeSetup(input, meta);
    await createSession(user.id, { mfaVerified: false, ip: meta.ip, userAgent: meta.userAgent });
    redirect(env().REQUIRE_ADMIN_MFA === "true" ? "/mfa/setup" : "/admin/dashboard");
  },
);
export async function setupAction(prev: ActionResult, fd: FormData) {
  return _setupAction(prev, fd);
}
