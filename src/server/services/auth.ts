import "server-only";
import type { OrgRole, UserKind } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { audit } from "../audit";
import { badRequest, conflict, forbidden, notFound } from "../errors";
import { burnPasswordCheck, hashPassword, passwordProblem, verifyPassword } from "../auth/password";
import { clearRateLimit, rateLimit } from "../auth/rate-limit";
import { consumeAuthToken, issueAuthToken } from "../auth/tokens";
import { createSession, destroyAllSessions, isPrivilegedRole, markSessionMfaVerified, type Actor } from "../auth/session";
import {
  decryptSecret,
  encryptSecret,
  generateRecoveryCodes,
  generateTotpSecret,
  secretToBase32,
  totpUri,
  verifyTotp,
} from "../auth/mfa";
import { sha256Hex } from "../crypto";
import { notify } from "./notifications";
import { numbers } from "../numbering";
import { hasPermission } from "../authz/check";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MINUTES = 15;

export type LoginResult = { status: "ok" | "mfa_required" | "mfa_setup_required"; kind: UserKind };

export async function login(emailRaw: string, password: string, meta: { ip: string; userAgent: string | null }): Promise<LoginResult> {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit(`login:ip:${meta.ip}`, 30, 15 * 60);
  await rateLimit(`login:email:${email}`, 10, 15 * 60);

  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  const generic = badRequest("Incorrect email or password.");
  if (!user || !user.passwordHash) {
    await burnPasswordCheck(password);
    throw generic;
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw badRequest("This account is temporarily locked after repeated failed sign-in attempts. Try again later or reset your password.");
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: failed >= MAX_FAILED_LOGINS ? 0 : failed,
        lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
      },
    });
    if (failed >= MAX_FAILED_LOGINS) {
      await audit(prisma, { actorId: user.id, action: "auth.lockout", entityType: "User", entityId: user.id, ipAddress: meta.ip });
    }
    throw generic;
  }
  if (user.status !== "ACTIVE") throw badRequest("This account is not active. Contact Sewer Squad for access.");

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
  await clearRateLimit(`login:email:${email}`);
  const mfaEnabled = Boolean(user.mfaEnabledAt);
  await createSession(user.id, { mfaVerified: !mfaEnabled, ip: meta.ip, userAgent: meta.userAgent });
  await audit(prisma, { actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id, ipAddress: meta.ip });

  if (mfaEnabled) return { status: "mfa_required", kind: user.kind };
  if (env().REQUIRE_ADMIN_MFA === "true" && isPrivilegedRole(user.role?.key)) return { status: "mfa_setup_required", kind: user.kind };
  return { status: "ok", kind: user.kind };
}

// ── Password reset ───────────────────────────────────────────────────────────

/** Always resolves the same way whether or not the account exists (no account enumeration). */
export async function requestPasswordReset(emailRaw: string, ip: string) {
  const email = emailRaw.trim().toLowerCase();
  await rateLimit(`reset:ip:${ip}`, 10, 60 * 60);
  await rateLimit(`reset:email:${email}`, 3, 60 * 60);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.status !== "ACTIVE") return;
  const token = await issueAuthToken(prisma, user.id, email, "PASSWORD_RESET");
  await notify(prisma, {
    userIds: [user.id],
    type: "account.security",
    title: "Reset your Sewer Squad password",
    body: "We received a request to reset your password. This link expires in 1 hour. If you did not request it, you can ignore this email.",
    link: `/reset-password?token=${encodeURIComponent(token)}`,
    dedupeKey: `password-reset:${sha256Hex(token).slice(0, 16)}`,
    forceEmail: true,
  });
}

export async function resetPassword(token: string, newPassword: string, ip: string) {
  await rateLimit(`reset-submit:ip:${ip}`, 20, 60 * 60);
  return prisma.$transaction(async (tx) => {
    const record = await consumeAuthToken(tx, token, "PASSWORD_RESET");
    if (!record) throw badRequest("This reset link is invalid or has expired. Request a new one.");
    const problem = passwordProblem(newPassword, record.user.email);
    if (problem) throw badRequest(problem);
    await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date(), failedLoginCount: 0, lockedUntil: null },
    });
    await tx.session.deleteMany({ where: { userId: record.userId } });
    await audit(tx, { actorId: record.userId, action: "auth.password_reset", entityType: "User", entityId: record.userId, ipAddress: ip });
    return record.user;
  });
}

export async function changePassword(actor: Actor, current: string, next: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, current))) throw badRequest("Current password is incorrect.");
  const problem = passwordProblem(next, user.email);
  if (problem) throw badRequest(problem);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
  await destroyAllSessions(user.id, actor.sessionId);
  await audit(prisma, { actorId: user.id, action: "auth.password_change", entityType: "User", entityId: user.id });
}

// ── Invitations ──────────────────────────────────────────────────────────────

export type InviteInput = {
  email: string;
  name: string;
  phone?: string;
  kind: UserKind;
  roleKey?: string; // STAFF / DRIVER
  organizationId?: string; // CUSTOMER
  orgRole?: OrgRole;
  canPay?: boolean;
  locationIds?: string[];
};

/**
 * Invitation-only onboarding. Privileged roles can only be granted by staff with `staff.manage`;
 * customer users require `customers.users`. Users can never pick their own role.
 */
export async function inviteUser(actor: Actor, input: InviteInput) {
  const email = input.email.trim().toLowerCase();
  if (input.kind === "CUSTOMER") {
    if (!hasPermission(actor, "customers.users")) throw forbidden();
    if (!input.organizationId || !input.orgRole) throw badRequest("Organization and role are required.");
  } else {
    if (!hasPermission(actor, "staff.manage")) throw forbidden();
    if (!input.roleKey) throw badRequest("Role is required.");
    if (input.kind === "DRIVER" && input.roleKey !== "driver") throw badRequest("Drivers must use the Driver role.");
    if (input.kind === "STAFF" && input.roleKey === "driver") throw badRequest("Use the driver invitation for drivers.");
    if (input.roleKey === "super_admin" && actor.roleKey !== "super_admin") throw forbidden("Only a super admin can invite super admins.");
  }

  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && existing.status !== "INVITED") throw conflict("A user with this email already exists.");
    if (existing && existing.kind !== input.kind) throw conflict("This email is already invited with a different account type.");

    const role = input.roleKey ? await tx.role.findUnique({ where: { key: input.roleKey } }) : null;
    if (input.roleKey && !role) throw badRequest("Unknown role.");

    const user = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name: input.name, phone: input.phone ?? existing.phone, roleId: role?.id ?? null } })
      : await tx.user.create({
          data: { email, name: input.name, phone: input.phone ?? null, kind: input.kind, status: "INVITED", roleId: role?.id ?? null },
        });

    if (input.kind === "CUSTOMER") {
      const org = await tx.organization.findFirst({ where: { id: input.organizationId, deletedAt: null } });
      if (!org) throw notFound("Organization not found.");
      await tx.organizationMembership.upsert({
        where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
        create: { organizationId: org.id, userId: user.id, role: input.orgRole!, canPay: input.canPay ?? input.orgRole !== "READ_ONLY" },
        update: { role: input.orgRole!, canPay: input.canPay ?? input.orgRole !== "READ_ONLY" },
      });
      if (input.orgRole !== "ORG_ADMIN") {
        const locs = await tx.serviceLocation.findMany({
          where: { id: { in: input.locationIds ?? [] }, organizationId: org.id, deletedAt: null },
          select: { id: true },
        });
        if (locs.length === 0) throw badRequest("Assign at least one location to this user.");
        for (const l of locs) {
          await tx.locationMembership.upsert({
            where: { locationId_userId: { locationId: l.id, userId: user.id } },
            create: { locationId: l.id, userId: user.id },
            update: {},
          });
        }
      }
    }

    if (input.kind === "DRIVER") {
      const existingDriver = await tx.driver.findUnique({ where: { userId: user.id } });
      if (!existingDriver) await tx.driver.create({ data: { userId: user.id, employeeNumber: await numbers.employee(tx) } });
    }

    const token = await issueAuthToken(tx, user.id, email, "INVITATION");
    await audit(tx, {
      actorId: actor.userId,
      action: "user.invite",
      entityType: "User",
      entityId: user.id,
      organizationId: input.organizationId ?? null,
      after: { email, kind: input.kind, roleKey: input.roleKey, orgRole: input.orgRole, locationIds: input.locationIds },
    });
    await notify(tx, {
      userIds: [user.id],
      type: "account.security",
      title: "You're invited to the Sewer Squad portal",
      body: `${actor.name} invited you to join the Sewer Squad portal. Use the link below to set your password. The invitation expires in 7 days.`,
      link: `/invite/accept?token=${encodeURIComponent(token)}`,
      dedupeKey: `invite:${sha256Hex(token).slice(0, 16)}`,
      forceEmail: true,
    });
    return { user, token };
  });
  return result;
}

export async function acceptInvitation(token: string, password: string, meta: { ip: string; userAgent: string | null }) {
  await rateLimit(`invite:ip:${meta.ip}`, 20, 60 * 60);
  const user = await prisma.$transaction(async (tx) => {
    const record = await consumeAuthToken(tx, token, "INVITATION");
    if (!record) throw badRequest("This invitation is invalid or has expired. Ask Sewer Squad to resend it.");
    if (record.user.status === "DEACTIVATED") throw badRequest("This account has been deactivated.");
    const problem = passwordProblem(password, record.user.email);
    if (problem) throw badRequest(problem);
    const u = await tx.user.update({
      where: { id: record.userId },
      data: { passwordHash: await hashPassword(password), status: "ACTIVE", emailVerifiedAt: new Date(), passwordChangedAt: new Date() },
      include: { role: true },
    });
    await audit(tx, { actorId: u.id, action: "user.invite_accepted", entityType: "User", entityId: u.id, ipAddress: meta.ip });
    return u;
  });
  await createSession(user.id, { mfaVerified: true, ip: meta.ip, userAgent: meta.userAgent });
  return user;
}

// ── Email verification (for email changes) ───────────────────────────────────

export async function requestEmailChange(actor: Actor, newEmailRaw: string) {
  const email = newEmailRaw.trim().toLowerCase();
  await rateLimit(`email-change:${actor.userId}`, 5, 3600);
  if (await prisma.user.findUnique({ where: { email } })) throw conflict("That email is already in use.");
  const token = await issueAuthToken(prisma, actor.userId, email, "EMAIL_VERIFICATION");
  // Send directly to the NEW address (the address being verified).
  const { sendEmail, renderEmailHtml } = await import("../integrations/email");
  const link = `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  const res = await sendEmail({
    to: email,
    subject: "Confirm your new email address",
    text: `Confirm this address for your Sewer Squad account:\n\n${link}`,
    html: renderEmailHtml("Confirm your new email address", "Confirm this address for your Sewer Squad account.", { label: "Confirm email", url: link }),
  });
  return res;
}

export async function verifyEmailToken(token: string) {
  return prisma.$transaction(async (tx) => {
    const record = await consumeAuthToken(tx, token, "EMAIL_VERIFICATION");
    if (!record) throw badRequest("This verification link is invalid or has expired.");
    if (await tx.user.findFirst({ where: { email: record.email, id: { not: record.userId } } })) throw conflict("That email is already in use.");
    const before = record.user.email;
    await tx.user.update({ where: { id: record.userId }, data: { email: record.email, emailVerifiedAt: new Date() } });
    await audit(tx, { actorId: record.userId, action: "user.email_changed", entityType: "User", entityId: record.userId, before: { email: before }, after: { email: record.email } });
  });
}

// ── MFA ──────────────────────────────────────────────────────────────────────

/** Begins enrollment. The pending secret is held encrypted in a short-lived, httpOnly cookie by the caller. */
export function beginMfaEnrollment(email: string) {
  const secret = generateTotpSecret();
  return { uri: totpUri(secret, email), base32: secretToBase32(secret), enc: encryptSecret(secret) };
}

export async function completeMfaEnrollment(actor: Actor, pendingEnc: string, code: string) {
  await rateLimit(`mfa-enroll:${actor.userId}`, 10, 15 * 60);
  const secret = decryptSecret(pendingEnc);
  if (!verifyTotp(secret, code)) throw badRequest("That code is not valid. Check your authenticator app's time and try again.");
  const { codes, hashes } = generateRecoveryCodes();
  await prisma.user.update({
    where: { id: actor.userId },
    data: { mfaSecretEnc: encryptSecret(secret), mfaEnabledAt: new Date(), mfaRecoveryHashes: hashes },
  });
  await markSessionMfaVerified(actor.sessionId);
  await destroyAllSessions(actor.userId, actor.sessionId);
  await audit(prisma, { actorId: actor.userId, action: "auth.mfa_enabled", entityType: "User", entityId: actor.userId });
  return codes;
}

export async function verifyMfaForSession(actor: Actor, code: string) {
  await rateLimit(`mfa-verify:${actor.userId}`, 8, 15 * 60);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.mfaSecretEnc) throw badRequest("MFA is not enabled for this account.");
  const clean = code.trim().toUpperCase();
  let ok = verifyTotp(decryptSecret(user.mfaSecretEnc), clean);
  if (!ok && /^[A-F0-9]{5}-[A-F0-9]{5}$/.test(clean)) {
    const h = sha256Hex(clean);
    if (user.mfaRecoveryHashes.includes(h)) {
      ok = true;
      await prisma.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((x) => x !== h) } });
      await audit(prisma, { actorId: user.id, action: "auth.mfa_recovery_code_used", entityType: "User", entityId: user.id });
    }
  }
  if (!ok) throw badRequest("That code is not valid.");
  await markSessionMfaVerified(actor.sessionId);
  await clearRateLimit(`mfa-verify:${actor.userId}`);
}

export async function disableMfa(actor: Actor, password: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) throw badRequest("Password is incorrect.");
  if (env().REQUIRE_ADMIN_MFA === "true" && isPrivilegedRole(actor.roleKey)) throw forbidden("MFA is required for your role and cannot be disabled.");
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecretEnc: null, mfaEnabledAt: null, mfaRecoveryHashes: [] } });
  await audit(prisma, { actorId: user.id, action: "auth.mfa_disabled", entityType: "User", entityId: user.id });
}

// ── Account lifecycle ────────────────────────────────────────────────────────

export async function setUserActive(actor: Actor, userId: string, active: boolean, reason?: string) {
  const target = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (!target) throw notFound();
  const needed = target.kind === "CUSTOMER" ? "customers.users" : "staff.manage";
  if (!hasPermission(actor, needed)) throw forbidden();
  if (target.id === actor.userId) throw badRequest("You cannot deactivate your own account.");
  if (target.role?.key === "super_admin" && actor.roleKey !== "super_admin") throw forbidden();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: active ? { status: target.passwordHash ? "ACTIVE" : "INVITED", deactivatedAt: null } : { status: "DEACTIVATED", deactivatedAt: new Date() },
    });
    if (!active) await tx.session.deleteMany({ where: { userId } });
    await audit(tx, {
      actorId: actor.userId,
      action: active ? "user.reactivate" : "user.deactivate",
      entityType: "User",
      entityId: userId,
      before: { status: target.status },
      after: { status: active ? "ACTIVE" : "DEACTIVATED" },
      reason: reason ?? null,
    });
  });
}
