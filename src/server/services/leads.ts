import "server-only";
import { createHmac } from "node:crypto";
import { z } from "zod";
import type { LeadStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import { env } from "../env";
import { logger } from "../logger";
import { safeEqual } from "../crypto";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { staffWithPermission } from "./notifications";

/**
 * Leads: sales inquiries. Emails to sewersquadservices@gmail.com and sales@ are auto-forwarded to
 * a Resend receiving address; Resend posts "email.received" here and each new sender becomes a
 * lead. A lead counts as contacted the first time someone calls, texts or emails it from the
 * portal, marks it contacted, or replies from one of our inboxes with the forwarding address in BCC.
 */

const ourInboxes = () => env().LEAD_INBOXES.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Svix-style signature check used by Resend webhooks. */
export function verifyResendWebhook(body: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, secret: string, now = Date.now()) {
  if (!headers.id || !headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 5 * 60) return false;
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, "base64");
  const expected = createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${body}`).digest("base64");
  return headers.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    return version === "v1" && !!sig && safeEqual(sig, expected);
  });
}

type ReceivedEmail = {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  received_for?: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  created_at: string;
  message_id?: string | null;
  headers?: Record<string, string>;
};

async function fetchReceivedEmail(id: string): Promise<ReceivedEmail> {
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${env().RESEND_API_KEY}` }, signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as ReceivedEmail;
}

/** "Jane Doe <jane@x.com>" → { name, email } */
export function parseAddress(v: string | null | undefined): { name: string | null; email: string | null } {
  if (!v) return { name: null, email: null };
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(v);
  if (m) return { name: m[1]!.trim() || null, email: m[2]!.trim().toLowerCase() };
  const e = /[^\s<>,;]+@[^\s<>,;]+/.exec(v)?.[0];
  return { name: null, email: e ? e.toLowerCase() : null };
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Drop quoted replies and Gmail's "---------- Forwarded message ---------" header block. */
function cleanBody(text: string) {
  const fwd = /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?\n\s*\n/i;
  let t = text.replace(fwd, "");
  t = t.split(/\n\s*On .{5,120}wrote:\s*\n/)[0]!;
  t = t.split(/\n>/)[0]!;
  return t.trim().slice(0, 5000);
}

/** Website form emails usually list "Name: …", "Phone: …", "Email: …". */
export function extractFields(text: string) {
  const grab = (label: string) => new RegExp(`^\\s*\\**(?:${label})\\**\\s*[:\\-]\\s*(.+)$`, "im").exec(text)?.[1]?.trim() ?? null;
  const phone = grab("phone|phone number|mobile|cell") ?? /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.exec(text)?.[0] ?? null;
  return {
    name: grab("name|full name|your name|contact name"),
    email: grab("email|e-mail|email address")?.match(/[^\s<>]+@[^\s<>]+/)?.[0]?.toLowerCase() ?? null,
    phone: phone ? phone.trim().slice(0, 40) : null,
    company: grab("company|business|business name|restaurant"),
  };
}

/** Forwarded mail keeps the original "From" in the body; prefer it over the forwarding mailbox. */
function forwardedFrom(text: string) {
  const m = /-{5,}\s*Forwarded message\s*-{5,}[\s\S]*?From:\s*(.+)/i.exec(text);
  return m ? parseAddress(m[1]!.replace(/\*/g, "").trim()) : null;
}

export async function ingestInboundEmail(emailId: string) {
  const mail = await fetchReceivedEmail(emailId);
  const ours = ourInboxes();
  const fromHeader = parseAddress(mail.headers?.from ?? mail.from);
  const ownSender = parseAddress(env().EMAIL_FROM).email;
  const rawText = mail.text || (mail.html ? htmlToText(mail.html) : "");
  const providerMessageId = mail.message_id || mail.id;
  const occurredAt = new Date(mail.created_at || Date.now());
  const recipients = [...mail.to, ...(mail.cc ?? []), ...(mail.bcc ?? []), ...(mail.received_for ?? [])].map((r) => parseAddress(r).email).filter((e): e is string => !!e);

  // Gmail asks to confirm a new forwarding address by email: surface the link to staff.
  if (fromHeader.email === "forwarding-noreply@google.com") {
    const link = /https:\/\/mail(?:-settings)?\.google\.com\/mail\/[^\s<>"]+/.exec(rawText)?.[0];
    await notifyStaff("Confirm Gmail forwarding", link ? `Gmail needs you to confirm forwarding to the leads inbox. Open this link while signed in to Gmail: ${link}` : `Gmail sent a forwarding confirmation: ${mail.subject ?? ""}`, "/admin/leads", `gmail-forwarding:${mail.id}`);
    return { kind: "forwarding-confirmation" as const };
  }
  if (fromHeader.email && fromHeader.email === ownSender) return { kind: "ignored" as const }; // our own notifications

  // One of us replied with the leads address in BCC: log it and mark the lead contacted.
  if (fromHeader.email && ours.includes(fromHeader.email) && !forwardedFrom(rawText)) {
    const others = recipients.filter((r) => !ours.includes(r) && !r.endsWith(".resend.app"));
    const lead = others.length ? await prisma.lead.findFirst({ where: { email: { in: others } }, orderBy: { receivedAt: "desc" } }) : null;
    if (!lead) return { kind: "ignored" as const };
    await prisma.$transaction(async (tx) => {
      await tx.leadActivity.create({ data: { leadId: lead.id, kind: "email_out", body: `${mail.subject ?? ""}\n\n${cleanBody(rawText)}`.trim().slice(0, 5000), occurredAt } });
      if (!lead.firstContactedAt) await tx.lead.update({ where: { id: lead.id }, data: { firstContactedAt: occurredAt, firstContactMethod: "email", status: lead.status === "NEW" ? "CONTACTED" : lead.status } });
    });
    return { kind: "reply-logged" as const, leadId: lead.id };
  }

  const fwd = forwardedFrom(rawText);
  const body = cleanBody(rawText);
  const fields = extractFields(body);
  const replyTo = parseAddress(mail.reply_to?.[0]);
  const sender = fwd?.email && !ours.includes(fwd.email) ? fwd : replyTo.email ? replyTo : fromHeader;
  const email = fields.email ?? sender.email;
  const inbox = recipients.find((r) => ours.includes(r)) ?? (fromHeader.email && ours.includes(fromHeader.email) ? fromHeader.email : null) ?? null;

  if (await prisma.lead.findUnique({ where: { providerMessageId } })) return { kind: "duplicate" as const };
  // A follow-up from someone we already have an open lead for joins that lead.
  const existing = email ? await prisma.lead.findFirst({ where: { email, status: { in: ["NEW", "CONTACTED", "QUOTED"] }, receivedAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, orderBy: { receivedAt: "desc" } }) : null;
  if (existing) {
    await prisma.leadActivity.create({ data: { leadId: existing.id, kind: "email_in", body: `${mail.subject ?? ""}\n\n${body}`.trim(), occurredAt } });
    await prisma.lead.update({ where: { id: existing.id }, data: { updatedAt: new Date(), phone: existing.phone ?? fields.phone } });
    await notifyStaff(`New message from ${existing.name ?? email}`, mail.subject ?? "Reply received", `/admin/leads/${existing.id}`, `lead-msg:${providerMessageId}`);
    return { kind: "followup" as const, leadId: existing.id };
  }

  const lead = await prisma.$transaction(async (tx) => {
    const org = email ? await tx.organization.findFirst({ where: { deletedAt: null, OR: [{ primaryEmail: email }, { contacts: { some: { email } } }] }, select: { id: true } }) : null;
    const created = await tx.lead.create({
      data: {
        leadNumber: await numbers.lead(tx),
        source: "email",
        inbox,
        name: fields.name ?? sender.name,
        company: fields.company,
        email,
        phone: fields.phone,
        subject: mail.subject?.replace(/^(fwd?|fw):\s*/i, "").slice(0, 300) ?? null,
        message: body,
        receivedAt: occurredAt,
        organizationId: org?.id ?? null,
        providerMessageId,
        activities: { create: { kind: "email_in", body: `${mail.subject ?? ""}\n\n${body}`.trim(), occurredAt } },
      },
    });
    await audit(tx, { actorId: null, action: "lead.create_from_email", entityType: "Lead", entityId: created.id, after: { inbox, email, subject: mail.subject } });
    return created;
  });
  await notifyStaff(`New lead: ${lead.name ?? lead.email ?? "unknown sender"}`, lead.subject ?? (lead.message ?? "").slice(0, 160), `/admin/leads/${lead.id}`, `lead:${lead.id}`);
  return { kind: "lead" as const, leadId: lead.id };
}

async function notifyStaff(title: string, body: string, link: string, dedupeKey: string) {
  const userIds = await staffWithPermission(prisma, "support.manage");
  if (!userIds.length) return;
  await prisma.notification.createMany({ data: userIds.map((userId) => ({ userId, type: "admin.support", title, body: body.slice(0, 500), link, entityType: "Lead", dedupeKey })), skipDuplicates: true });
}

// ── Staff actions ────────────────────────────────────────────────────────────

export const leadSchema = z.object({
  name: z.string().trim().max(200).optional(),
  company: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").optional().or(z.literal("").transform(() => undefined)),
  phone: z.string().trim().max(40).optional(),
  source: z.enum(["phone", "website", "referral", "email", "other"]).default("phone"),
  message: z.string().trim().max(5000).optional(),
  contactedNow: z.coerce.boolean().optional().default(false),
});

export async function createLead(actor: Actor, input: z.infer<typeof leadSchema>) {
  assertStaffActor(actor, "support.manage");
  if (!input.name && !input.email && !input.phone && !input.company) throw badRequest("Enter at least a name, phone or email.");
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    const lead = await tx.lead.create({
      data: {
        leadNumber: await numbers.lead(tx),
        source: input.source,
        name: input.name ?? null,
        company: input.company ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        message: input.message ?? null,
        createdById: actor.userId,
        // A phone call is a first contact as it happens.
        ...(input.contactedNow ? { status: "CONTACTED", firstContactedAt: now, firstContactedById: actor.userId, firstContactMethod: input.source === "phone" ? "call" : "other" } : {}),
        activities: { create: { kind: "note", body: input.message ? `Lead added: ${input.message}` : "Lead added", actorId: actor.userId } },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "lead.create", entityType: "Lead", entityId: lead.id, after: input });
    return lead;
  });
}

const METHODS = ["call", "text", "email", "in_person", "other"] as const;
export type ContactMethod = (typeof METHODS)[number];

/** Log a touch (call, text, email…). The first one sets "time to first contact". */
export async function logLeadContact(actor: Actor, leadId: string, method: ContactMethod, note?: string) {
  assertStaffActor(actor, "support.manage");
  if (!METHODS.includes(method)) throw badRequest("Unknown contact method.");
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound();
    const now = new Date();
    await tx.leadActivity.create({ data: { leadId, kind: method === "email" ? "email_out" : method === "call" ? "call" : method === "text" ? "text" : "note", body: note?.trim() || `${method === "call" ? "Called" : method === "text" ? "Texted" : method === "email" ? "Emailed" : "Contacted"} by ${actor.name}`, actorId: actor.userId, occurredAt: now } });
    const data: Prisma.LeadUpdateInput = {};
    if (!lead.firstContactedAt) Object.assign(data, { firstContactedAt: now, firstContactedById: actor.userId, firstContactMethod: method });
    if (lead.status === "NEW") data.status = "CONTACTED";
    if (Object.keys(data).length) await tx.lead.update({ where: { id: leadId }, data });
  });
}

export async function setLeadStatus(actor: Actor, leadId: string, status: LeadStatus, note?: string) {
  assertStaffActor(actor, "support.manage");
  return prisma.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({ where: { id: leadId } });
    if (!lead) throw notFound();
    await tx.lead.update({ where: { id: leadId }, data: { status, ...(status !== "NEW" && !lead.firstContactedAt ? { firstContactedAt: new Date(), firstContactedById: actor.userId, firstContactMethod: "other" } : {}) } });
    await tx.leadActivity.create({ data: { leadId, kind: "status", body: `${lead.status.toLowerCase()} → ${status.toLowerCase()}${note ? `: ${note}` : ""}`, actorId: actor.userId } });
  });
}

export async function addLeadNote(actor: Actor, leadId: string, body: string, followUp?: string | null) {
  assertStaffActor(actor, "support.manage");
  if (!body.trim() && !followUp) throw badRequest("Write a note.");
  if (!(await prisma.lead.count({ where: { id: leadId } }))) throw notFound();
  await prisma.$transaction(async (tx) => {
    if (body.trim()) await tx.leadActivity.create({ data: { leadId, kind: "note", body: body.trim().slice(0, 5000), actorId: actor.userId } });
    if (followUp !== undefined) await tx.lead.update({ where: { id: leadId }, data: { nextFollowUpAt: followUp ? new Date(followUp) : null } });
  });
}

/** Minutes from arrival to first contact. */
export function minutesToContact(l: { receivedAt: Date; firstContactedAt: Date | null }, now = new Date()) {
  return Math.max(0, Math.round(((l.firstContactedAt ?? now).getTime() - l.receivedAt.getTime()) / 60_000));
}

export function formatDuration(min: number) {
  if (min < 60) return `${min}m`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ${min % 60 ? `${min % 60}m` : ""}`.trim();
  return `${Math.round(min / 1440)}d`;
}

export async function leadStats() {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [uncontacted, recent] = await Promise.all([
    prisma.lead.count({ where: { firstContactedAt: null, status: { in: ["NEW"] } } }),
    prisma.lead.findMany({ where: { receivedAt: { gte: since } }, select: { receivedAt: true, firstContactedAt: true, status: true } }),
  ]);
  const contacted = recent.filter((l) => l.firstContactedAt);
  const mins = contacted.map((l) => minutesToContact(l)).sort((a, b) => a - b);
  const median = mins.length ? mins[Math.floor(mins.length / 2)]! : null;
  const withinHour = mins.length ? Math.round((mins.filter((m) => m <= 60).length / mins.length) * 100) : null;
  return { uncontacted, last30: recent.length, won: recent.filter((l) => l.status === "WON").length, medianMinutes: median, withinHourPct: withinHour };
}

export function logInboundError(err: unknown, emailId: string) {
  logger.error("leads.inbound_failed", { err, emailId });
}
