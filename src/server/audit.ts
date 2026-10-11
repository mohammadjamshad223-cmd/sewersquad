import "server-only";
import { Prisma } from "@prisma/client";
import type { Db } from "./db";

export type AuditEntry = {
  actorId?: string | null;
  action: string; // e.g. "invoice.create", "manifest.correct"
  entityType: string;
  entityId: string;
  organizationId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ipAddress?: string | null;
};

function toJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === undefined || value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))) as Prisma.InputJsonValue;
}

/** Write an append-only audit entry. Call inside the same transaction as the change it records. */
export async function audit(db: Db, entry: AuditEntry) {
  await db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      organizationId: entry.organizationId ?? null,
      before: toJson(entry.before),
      after: toJson(entry.after),
      reason: entry.reason ?? null,
      ipAddress: entry.ipAddress ?? null,
    },
  });
}

/** Returns only the keys whose values differ, for compact before/after audit payloads. */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>) {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    const nv = after[key];
    const ov = before[key];
    if (JSON.stringify(nv) !== JSON.stringify(ov)) {
      b[key] = ov;
      a[key] = nv;
    }
  }
  return { before: b, after: a, changed: Object.keys(a).length > 0 };
}
