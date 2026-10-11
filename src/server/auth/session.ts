import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import type { OrgRole, UserKind } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { randomToken, sha256Hex } from "../crypto";
import { PRIVILEGED_ROLES, type Permission, type SystemRoleKey } from "../authz/permissions";

export const SESSION_COOKIE = "ss_session";
const TOUCH_INTERVAL_MS = 5 * 60_000;

export type Actor = {
  userId: string;
  sessionId: string;
  email: string;
  name: string;
  kind: UserKind;
  roleKey: string | null;
  permissions: ReadonlySet<Permission>;
  mfaEnabled: boolean;
  mfaVerified: boolean;
  /** True when this account must enroll in MFA before it can use the platform. */
  mfaEnrollmentRequired: boolean;
  driverId: string | null;
  memberships: { organizationId: string; role: OrgRole; canPay: boolean }[];
  locationIds: string[];
};

function ttlMs() {
  return env().SESSION_TTL_HOURS * 3600_000;
}

export async function createSession(userId: string, opts: { mfaVerified: boolean; ip?: string | null; userAgent?: string | null }) {
  const token = randomToken(32);
  const id = sha256Hex(token);
  const expiresAt = new Date(Date.now() + ttlMs());
  await prisma.session.create({
    data: { id, userId, expiresAt, mfaVerified: opts.mfaVerified, ipAddress: opts.ip ?? null, userAgent: opts.userAgent ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return id;
}

export async function destroyCurrentSession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sha256Hex(token) } });
  jar.delete(SESSION_COOKIE);
}

export async function destroyAllSessions(userId: string, exceptSessionId?: string) {
  await prisma.session.deleteMany({ where: { userId, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) } });
}

export async function markSessionMfaVerified(sessionId: string) {
  await prisma.session.update({ where: { id: sessionId }, data: { mfaVerified: true } });
}

export function isPrivilegedRole(roleKey: string | null | undefined) {
  return Boolean(roleKey && PRIVILEGED_ROLES.includes(roleKey as SystemRoleKey));
}

/** Loads the actor for an already-hashed session id. Exposed for tests and route handlers. */
export async function loadActorBySessionId(sessionId: string): Promise<Actor | null> {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
          driver: { select: { id: true, status: true } },
          orgMemberships: { select: { organizationId: true, role: true, canPay: true, organization: { select: { status: true, deletedAt: true } } } },
          locationMemberships: { select: { locationId: true } },
        },
      },
    },
  });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.deleteMany({ where: { id: sessionId } });
    return null;
  }
  const user = session.user;
  if (user.status !== "ACTIVE") return null;

  // Sliding expiration, written at most every few minutes.
  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session
      .update({ where: { id: sessionId }, data: { lastSeenAt: new Date(), expiresAt: new Date(now + ttlMs()) } })
      .catch(() => undefined);
  }

  const roleKey = user.role?.key ?? null;
  const permissions = new Set<Permission>((user.role?.permissions ?? []).map((rp) => rp.permission.key as Permission));
  const mfaEnabled = Boolean(user.mfaEnabledAt);
  const mfaEnrollmentRequired = env().REQUIRE_ADMIN_MFA === "true" && isPrivilegedRole(roleKey) && !mfaEnabled;

  return {
    userId: user.id,
    sessionId,
    email: user.email,
    name: user.name,
    kind: user.kind,
    roleKey,
    permissions,
    mfaEnabled,
    mfaVerified: session.mfaVerified,
    mfaEnrollmentRequired,
    driverId: user.driver && user.driver.status !== "INACTIVE" ? user.driver.id : null,
    memberships: user.orgMemberships
      .filter((m) => m.organization.status === "ACTIVE" && !m.organization.deletedAt)
      .map(({ organizationId, role, canPay }) => ({ organizationId, role, canPay })),
    locationIds: user.locationMemberships.map((l) => l.locationId),
  };
}

/** Current actor for this request (memoized per request). Null if not signed in. */
export const getActor = cache(async (): Promise<Actor | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return loadActorBySessionId(sha256Hex(token));
});

export function homePathFor(actor: Pick<Actor, "kind">): string {
  if (actor.kind === "CUSTOMER") return "/customer/dashboard";
  if (actor.kind === "DRIVER") return "/driver/dashboard";
  return "/admin/dashboard";
}
