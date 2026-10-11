import "server-only";
import type { NotificationChannel, UserKind } from "@prisma/client";
import { prisma, type Db } from "../db";
import { env } from "../env";
import { logger } from "../logger";
import { renderEmailHtml, sendEmail } from "../integrations/email";
import { sendSms } from "../integrations/sms";

/**
 * Notification catalogue. `defaults` are used when a user has not stored a preference.
 * SMS is always opt-in.
 */
export const NOTIFICATION_TYPES = {
  // Customer
  "service.scheduled": { audience: "CUSTOMER", label: "Service scheduled", defaults: { email: true, sms: false } },
  "service.reminder": { audience: "CUSTOMER", label: "Service reminders", defaults: { email: true, sms: false } },
  "service.en_route": { audience: "CUSTOMER", label: "Driver en route", defaults: { email: false, sms: false } },
  "service.completed": { audience: "CUSTOMER", label: "Service completed", defaults: { email: true, sms: false } },
  "manifest.available": { audience: "CUSTOMER", label: "Manifest available", defaults: { email: true, sms: false } },
  "invoice.issued": { audience: "CUSTOMER", label: "Invoice issued", defaults: { email: true, sms: false } },
  "invoice.reminder": { audience: "CUSTOMER", label: "Invoice reminders", defaults: { email: true, sms: false } },
  "payment.received": { audience: "CUSTOMER", label: "Payment received", defaults: { email: true, sms: false } },
  "payment.failed": { audience: "ANY", label: "Payment failed", defaults: { email: true, sms: false } },
  "payment.refunded": { audience: "CUSTOMER", label: "Refund issued", defaults: { email: true, sms: false } },
  "emergency.update": { audience: "CUSTOMER", label: "Emergency request updates", defaults: { email: true, sms: false } },
  "support.reply": { audience: "CUSTOMER", label: "Support replies", defaults: { email: true, sms: false } },
  // Driver
  "job.assigned": { audience: "DRIVER", label: "New job assigned", defaults: { email: false, sms: false } },
  "job.changed": { audience: "DRIVER", label: "Schedule changed", defaults: { email: false, sms: false } },
  "job.cancelled": { audience: "DRIVER", label: "Job cancelled", defaults: { email: false, sms: false } },
  "emergency.assigned": { audience: "DRIVER", label: "Emergency dispatch assigned", defaults: { email: true, sms: false } },
  "manifest.correction": { audience: "DRIVER", label: "Manifest correction requested", defaults: { email: true, sms: false } },
  // Admin
  "admin.emergency": { audience: "STAFF", label: "Emergency request received", defaults: { email: true, sms: false } },
  "admin.job_submitted": { audience: "STAFF", label: "Job submitted for review", defaults: { email: false, sms: false } },
  "admin.issue": { audience: "STAFF", label: "Driver reported issue", defaults: { email: true, sms: false } },
  "admin.payment_failed": { audience: "STAFF", label: "Payment failed", defaults: { email: true, sms: false } },
  "admin.invoice_overdue": { audience: "STAFF", label: "Invoice overdue", defaults: { email: false, sms: false } },
  "admin.schedule_conflict": { audience: "STAFF", label: "Schedule conflict", defaults: { email: false, sms: false } },
  "admin.support": { audience: "STAFF", label: "New customer inquiry", defaults: { email: false, sms: false } },
  // Account
  "account.security": { audience: "ANY", label: "Account security", defaults: { email: true, sms: false } },
} as const satisfies Record<string, { audience: UserKind | "ANY"; label: string; defaults: { email: boolean; sms: boolean } }>;

export type NotificationType = keyof typeof NOTIFICATION_TYPES;

export type NotifyInput = {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  entityType?: string;
  entityId?: string;
  /** Duplicate suppression: one notification per (user, dedupeKey). */
  dedupeKey: string;
  /** Force email regardless of preference (e.g. password reset, invitation). */
  forceEmail?: boolean;
};

/**
 * Records notifications and queues deliveries according to each user's preferences.
 * Safe to call inside a transaction; delivery itself happens in processDueDeliveries().
 */
export async function notify(db: Db, input: NotifyInput): Promise<string[]> {
  const userIds = [...new Set(input.userIds)];
  if (userIds.length === 0) return [];
  const users = await db.user.findMany({
    where: { id: { in: userIds }, status: { not: "DEACTIVATED" } },
    select: { id: true, email: true, phone: true, notificationPreferences: { where: { type: input.type } } },
  });
  const defaults = NOTIFICATION_TYPES[input.type].defaults;
  const created: string[] = [];
  for (const user of users) {
    const pref = user.notificationPreferences[0];
    if (pref && !pref.inApp && !pref.email && !pref.sms && !input.forceEmail) continue;
    const existing = await db.notification.findUnique({ where: { userId_dedupeKey: { userId: user.id, dedupeKey: input.dedupeKey } } });
    if (existing) continue;
    const n = await db.notification.create({
      data: {
        userId: user.id,
        type: input.type,
        title: input.title,
        body: input.body,
        link: input.link ?? null,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        dedupeKey: input.dedupeKey,
      },
    });
    created.push(n.id);
    const wantsEmail = input.forceEmail || (pref ? pref.email : defaults.email);
    const wantsSms = pref ? pref.sms : defaults.sms;
    const deliveries: { channel: NotificationChannel; destination: string }[] = [];
    if (wantsEmail) deliveries.push({ channel: "EMAIL", destination: user.email });
    if (wantsSms && user.phone) deliveries.push({ channel: "SMS", destination: user.phone });
    if (deliveries.length) {
      await db.notificationDelivery.createMany({
        data: deliveries.map((d) => ({ notificationId: n.id, ...d })),
        skipDuplicates: true,
      });
    }
  }
  return created;
}

/** Staff users holding a permission (used to route admin alerts). */
export async function staffWithPermission(db: Db, permission: string): Promise<string[]> {
  const users = await db.user.findMany({
    where: { kind: "STAFF", status: "ACTIVE", role: { permissions: { some: { permission: { key: permission } } } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

/** Customer users who should hear about a given location (org admins + assigned location users). */
export async function customerRecipientsForLocation(db: Db, organizationId: string, locationId: string | null): Promise<string[]> {
  const members = await db.organizationMembership.findMany({
    where: { organizationId, user: { status: "ACTIVE" } },
    select: { userId: true, role: true, user: { select: { locationMemberships: { select: { locationId: true } } } } },
  });
  return members
    .filter((m) => m.role === "ORG_ADMIN" || (locationId && m.user.locationMemberships.some((l) => l.locationId === locationId)))
    .map((m) => m.userId);
}

const MAX_ATTEMPTS = 5;

/** Sends queued deliveries with exponential-backoff retries. Called after mutations and by cron. */
export async function processDueDeliveries(limit = 25) {
  const due = await prisma.notificationDelivery.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: new Date() } },
    include: { notification: true },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
  });
  let sent = 0;
  for (const d of due) {
    // Claim the row so concurrent workers do not double-send.
    const claimed = await prisma.notificationDelivery.updateMany({
      where: { id: d.id, status: "PENDING", attempts: d.attempts },
      data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) },
    });
    if (claimed.count === 0) continue;
    const link = d.notification.link ? new URL(d.notification.link, env().APP_URL).toString() : undefined;
    const result =
      d.channel === "EMAIL"
        ? await sendEmail({
            to: d.destination,
            subject: d.notification.title,
            text: link ? `${d.notification.body}\n\n${link}` : d.notification.body,
            html: renderEmailHtml(d.notification.title, d.notification.body, link ? { label: "Open Sewer Squad", url: link } : undefined),
          })
        : await sendSms(d.destination, `${d.notification.title}: ${d.notification.body}${link ? ` ${link}` : ""}`);

    if (result.status === "sent") {
      sent++;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: { status: "SENT", sentAt: new Date(), providerMessageId: result.providerId, lastError: null },
      });
    } else if (result.status === "skipped") {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", lastError: result.reason } });
    } else {
      const attempts = d.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: final ? "FAILED" : "PENDING",
          lastError: result.error,
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts * 60_000, 6 * 3600_000)),
        },
      });
      logger.warn("notification.delivery_failed", { deliveryId: d.id, channel: d.channel, attempts, final, error: result.error });
    }
  }
  return { processed: due.length, sent };
}

export async function unreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function listNotifications(userId: string, opts: { page?: number; unreadOnly?: boolean } = {}) {
  const page = Math.max(1, opts.page ?? 1);
  const where = { userId, ...(opts.unreadOnly ? { readAt: null } : {}) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.notification.count({ where }),
  ]);
  return { items, total, page, pageSize: 25 };
}

export async function markRead(userId: string, ids: string[] | "all") {
  await prisma.notification.updateMany({
    where: { userId, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
}

export function preferenceTypesFor(kind: UserKind) {
  return (Object.entries(NOTIFICATION_TYPES) as [NotificationType, (typeof NOTIFICATION_TYPES)[NotificationType]][]).filter(
    ([, v]) => v.audience === kind || v.audience === "ANY",
  );
}
