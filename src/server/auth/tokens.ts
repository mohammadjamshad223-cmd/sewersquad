import "server-only";
import type { AuthTokenType } from "@prisma/client";
import { prisma, type Db } from "../db";
import { randomToken, sha256Hex } from "../crypto";

const TTL_HOURS: Record<AuthTokenType, number> = {
  EMAIL_VERIFICATION: 48,
  PASSWORD_RESET: 1,
  INVITATION: 24 * 7,
};

/** Creates a single-use token. Only its hash is stored. Returns the raw token for the email link. */
export async function issueAuthToken(db: Db, userId: string, email: string, type: AuthTokenType): Promise<string> {
  // Invalidate previous outstanding tokens of the same type.
  await db.authToken.updateMany({ where: { userId, type, usedAt: null }, data: { usedAt: new Date() } });
  const raw = randomToken(32);
  await db.authToken.create({
    data: {
      userId,
      email,
      type,
      tokenHash: sha256Hex(raw),
      expiresAt: new Date(Date.now() + TTL_HOURS[type] * 3600_000),
    },
  });
  return raw;
}

/** Looks up a token without consuming it (used to render the form). */
export async function peekAuthToken(raw: string, type: AuthTokenType) {
  const token = await prisma.authToken.findUnique({ where: { tokenHash: sha256Hex(raw) }, include: { user: true } });
  if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) return null;
  return token;
}

/** Atomically consumes the token. Returns null if it was already used, expired or wrong type. */
export async function consumeAuthToken(db: Db, raw: string, type: AuthTokenType) {
  const tokenHash = sha256Hex(raw);
  const res = await db.authToken.updateMany({
    where: { tokenHash, type, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  if (res.count !== 1) return null;
  return db.authToken.findUnique({ where: { tokenHash }, include: { user: true } });
}
