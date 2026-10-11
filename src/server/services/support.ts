import "server-only";
import { z } from "zod";
import type { TicketStatus } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/guards";
import { customerScopeFor, invoiceScopedWhere } from "../authz/scope";
import { rateLimit } from "../auth/rate-limit";
import { notify, staffWithPermission } from "./notifications";
import { storeDocument } from "./documents";

export const ticketSchema = z.object({
  category: z.enum(["GENERAL", "BILLING", "SERVICE_ISSUE", "CALLBACK", "RESCHEDULE", "ADDITIONAL_SERVICE"]),
  subject: z.string().trim().min(3, "Add a short subject.").max(200),
  body: z.string().trim().min(5, "Add a message.").max(5000),
  locationId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  jobId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  invoiceId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  callbackPhone: z.string().trim().max(40).optional(),
  requestedDate: z.string().optional(),
});

/** Customer-created inquiry. Every linked record is verified against the customer's scope. */
export async function createTicket(actor: Actor, input: z.infer<typeof ticketSchema>, files: { bytes: Uint8Array; name: string }[]) {
  const scope = await customerScopeFor(actor);
  await rateLimit(`ticket:${actor.userId}`, 20, 3600);
  let organizationId = scope.orgIds[0];
  if (input.locationId) {
    const loc = scope.locations.find((l) => l.id === input.locationId);
    if (!loc) throw notFound();
    organizationId = loc.organizationId;
  }
  if (input.jobId) {
    const job = await prisma.job.findFirst({ where: { id: input.jobId, locationId: { in: scope.locationIds } } });
    if (!job) throw notFound();
    organizationId = job.organizationId;
    input.locationId ??= job.locationId;
  }
  if (input.invoiceId) {
    const inv = await prisma.invoice.findFirst({ where: { AND: [{ id: input.invoiceId }, invoiceScopedWhere(scope)] } });
    if (!inv) throw notFound();
    organizationId = inv.organizationId;
  }
  if (!organizationId) throw badRequest("Your account is not linked to an organization.");
  if (input.category === "CALLBACK" && !input.callbackPhone) throw badRequest("Enter a callback phone number.");
  const { isDateKey, dateFromKey } = await import("@/lib/dates");
  return prisma.$transaction(async (tx) => {
    const t = await tx.supportTicket.create({
      data: {
        ticketNumber: await numbers.ticket(tx),
        organizationId: organizationId!,
        locationId: input.locationId ?? null,
        createdById: actor.userId,
        category: input.category,
        subject: input.subject,
        jobId: input.jobId ?? null,
        invoiceId: input.invoiceId ?? null,
        callbackPhone: input.callbackPhone ?? null,
        requestedDate: input.requestedDate && isDateKey(input.requestedDate) ? dateFromKey(input.requestedDate) : null,
        messages: { create: { authorId: actor.userId, body: input.body } },
      },
    });
    for (const f of files.slice(0, 5)) {
      await storeDocument(tx, { bytes: f.bytes, fileName: f.name, type: "SUPPORT_ATTACHMENT", title: `${t.ticketNumber} attachment`, visibility: "CUSTOMER", organizationId: organizationId!, locationId: input.locationId ?? null, supportTicketId: t.id, uploadedById: actor.userId });
    }
    await audit(tx, { actorId: actor.userId, action: "support.create", entityType: "SupportTicket", entityId: t.id, organizationId, after: { category: input.category, subject: input.subject } });
    await notify(tx, { userIds: await staffWithPermission(tx, "support.manage"), type: "admin.support", title: `New inquiry ${t.ticketNumber}: ${input.subject}`, body: input.body.slice(0, 200), link: `/admin/support/${t.id}`, entityType: "SupportTicket", entityId: t.id, dedupeKey: `ticket:${t.id}:new` });
    return t;
  });
}

export async function getTicketForCustomer(actor: Actor, ticketId: string) {
  const scope = await customerScopeFor(actor);
  const t = await prisma.supportTicket.findFirst({
    where: { id: ticketId, organizationId: { in: scope.orgIds }, OR: [{ locationId: { in: scope.locationIds } }, { createdById: actor.userId }, { locationId: null, organizationId: { in: scope.orgAdminOrgIds } }] },
    include: {
      messages: { where: { isInternal: false }, orderBy: { createdAt: "asc" } }, // internal notes never leave the server
      documents: { where: { deletedAt: null, visibility: "CUSTOMER" } },
      location: { select: { name: true } },
    },
  });
  if (!t) throw notFound();
  return t;
}

export async function customerReply(actor: Actor, ticketId: string, body: string) {
  const t = await getTicketForCustomer(actor, ticketId);
  if (t.status === "CLOSED") throw badRequest("This inquiry is closed. Open a new one if you need more help.");
  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.create({ data: { ticketId, authorId: actor.userId, body } });
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status: t.status === "WAITING_ON_CUSTOMER" || t.status === "RESOLVED" ? "OPEN" : t.status } });
    if (t.assignedToId) await notify(tx, { userIds: [t.assignedToId], type: "admin.support", title: `Customer replied on ${t.ticketNumber}`, body: body.slice(0, 200), link: `/admin/support/${ticketId}`, entityType: "SupportTicket", entityId: ticketId, dedupeKey: `ticket:${ticketId}:reply:${Date.now()}` });
  });
}

export async function staffReply(actor: Actor, ticketId: string, input: { body: string; internal: boolean; status?: TicketStatus }) {
  assertStaffActor(actor, "support.manage");
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.supportMessage.create({ data: { ticketId, authorId: actor.userId, body: input.body, isInternal: input.internal } });
    const nextStatus = input.status ?? (input.internal ? t.status : t.status === "OPEN" ? "IN_PROGRESS" : t.status);
    await tx.supportTicket.update({ where: { id: ticketId }, data: { status: nextStatus, assignedToId: t.assignedToId ?? actor.userId } });
    await audit(tx, { actorId: actor.userId, action: input.internal ? "support.internal_note" : "support.reply", entityType: "SupportTicket", entityId: ticketId, organizationId: t.organizationId, after: { status: nextStatus } });
    if (!input.internal) {
      await notify(tx, { userIds: [t.createdById], type: "support.reply", title: `Reply on ${t.ticketNumber}: ${t.subject}`, body: input.body.slice(0, 300), link: `/customer/support/${ticketId}`, entityType: "SupportTicket", entityId: ticketId, dedupeKey: `ticket:${ticketId}:staff-reply:${Date.now()}` });
    }
  });
}

export async function updateTicket(actor: Actor, ticketId: string, input: { status?: TicketStatus; assignedToId?: string | null; jobId?: string | null; invoiceId?: string | null }) {
  assertStaffActor(actor, "support.manage");
  const t = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
  if (!t) throw notFound();
  if (input.jobId && !(await prisma.job.count({ where: { id: input.jobId, organizationId: t.organizationId } }))) throw badRequest("Job belongs to another customer.");
  if (input.invoiceId && !(await prisma.invoice.count({ where: { id: input.invoiceId, organizationId: t.organizationId } }))) throw badRequest("Invoice belongs to another customer.");
  await prisma.$transaction(async (tx) => {
    await tx.supportTicket.update({ where: { id: ticketId }, data: input });
    await audit(tx, { actorId: actor.userId, action: "support.update", entityType: "SupportTicket", entityId: ticketId, organizationId: t.organizationId, before: { status: t.status, assignedToId: t.assignedToId }, after: input });
  });
}
