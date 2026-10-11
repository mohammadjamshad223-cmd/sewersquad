"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { assertCustomer } from "@/server/authz/guards";
import { customerScopeFor } from "@/server/authz/scope";
import { LOCATION_COOKIE } from "@/server/customer-context";
import { env } from "@/server/env";
import { formAction, runAction, type ActionResult } from "@/server/action";
import { notFound } from "@/server/errors";
import { createCheckout } from "@/server/services/payments";
import { emergencySchema, submitEmergency } from "@/server/services/emergencies";
import { createTicket, customerReply, ticketSchema } from "@/server/services/support";
import { readUploadedFile } from "@/server/services/documents";
import { processDueDeliveries } from "@/server/services/notifications";
import { parseDollarsToCents } from "@/lib/money";

async function files(fd: FormData, key: string) {
  const out: { bytes: Uint8Array; name: string }[] = [];
  for (const f of fd.getAll(key)) {
    const r = await readUploadedFile(f);
    if (r) out.push(r);
  }
  return out;
}

export async function selectLocationAction(locationId: string | null) {
  return runAction(async () => {
    const actor = await assertCustomer();
    const scope = await customerScopeFor(actor);
    const jar = await cookies();
    if (!locationId) {
      jar.delete(LOCATION_COOKIE);
      return null;
    }
    if (!scope.locationIds.includes(locationId)) throw notFound();
    jar.set(LOCATION_COOKIE, locationId, { httpOnly: true, sameSite: "lax", secure: env().NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 180 });
    return locationId;
  });
}

const _pay = formAction(
  z.object({ invoiceIds: z.array(z.string().uuid()).min(1, "Select at least one invoice."), amount: z.string().optional() }),
  async (input) => {
    const actor = await assertCustomer();
    const cents = input.amount ? parseDollarsToCents(input.amount) : undefined;
    if (input.amount && (cents === null || cents === undefined)) return { ok: false, error: "Enter a valid amount.", fieldErrors: { amount: ["Enter a valid amount."] } };
    const { url } = await createCheckout(actor, input.invoiceIds, cents ?? undefined);
    redirect(url);
  },
);
export async function payInvoicesAction(prev: ActionResult, fd: FormData) {
  return _pay(prev, fd);
}

const _emergency = formAction(emergencySchema, async (input, fd) => {
  const actor = await assertCustomer();
  const er = await submitEmergency(actor, input, await files(fd, "photos"));
  after(() => processDueDeliveries());
  redirect(`/customer/request-service/${er.id}?submitted=1`);
});
export async function submitEmergencyAction(prev: ActionResult, fd: FormData) {
  return _emergency(prev, fd);
}

const _ticket = formAction(ticketSchema, async (input, fd) => {
  const actor = await assertCustomer();
  const t = await createTicket(actor, input, await files(fd, "attachments"));
  after(() => processDueDeliveries());
  redirect(`/customer/support/${t.id}?created=1`);
});
export async function createTicketAction(prev: ActionResult, fd: FormData) {
  return _ticket(prev, fd);
}

const _reply = formAction(z.object({ ticketId: z.string().uuid(), body: z.string().trim().min(1).max(5000) }), async (input) => {
  const actor = await assertCustomer();
  await customerReply(actor, input.ticketId, input.body);
  after(() => processDueDeliveries());
  return { ok: true, message: "Reply sent." };
});
export async function replyTicketAction(prev: ActionResult, fd: FormData) {
  return _reply(prev, fd);
}
