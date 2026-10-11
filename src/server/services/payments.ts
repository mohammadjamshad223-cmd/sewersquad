import "server-only";
import type Stripe from "stripe";
import { prisma, type Db } from "../db";
import { env, integrations } from "../env";
import { audit } from "../audit";
import { logger } from "../logger";
import { badRequest, notConfigured, notFound } from "../errors";
import { numbers } from "../numbering";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { canPayForOrg, customerScopeFor, invoiceScopedWhere } from "../authz/scope";
import { allocatePayment } from "@/domain/invoice-math";
import { formatCents } from "@/lib/money";
import { applyAllocation, reverseAllocation } from "./invoices";
import { getSetting } from "./settings";
import { customerRecipientsForLocation, notify, staffWithPermission } from "./notifications";
import { storeDocument } from "./documents";

let stripeClient: Stripe | null = null;
async function stripe(): Promise<Stripe> {
  if (!integrations.stripe()) throw notConfigured("Online payments are not configured yet (Stripe keys missing). Contact Sewer Squad to pay by check or phone.");
  if (!stripeClient) {
    const { default: StripeCtor } = await import("stripe");
    stripeClient = new StripeCtor(env().STRIPE_SECRET_KEY!, { maxNetworkRetries: 2, appInfo: { name: "Sewer Squad Portal" } });
  }
  return stripeClient;
}

export function stripeIsLiveKey() {
  return Boolean(env().STRIPE_SECRET_KEY?.startsWith("sk_live_"));
}

const PAYABLE = ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] as const;

/**
 * Customer checkout. Creates a PENDING payment with unapplied allocations, then a Stripe-hosted
 * Checkout Session. Balances only change when a verified webhook confirms settlement.
 */
export async function createCheckout(actor: Actor, invoiceIds: string[], requestedAmountCents?: number) {
  if (actor.kind !== "CUSTOMER") throw badRequest("Only customer accounts can pay online.");
  if (invoiceIds.length === 0 || invoiceIds.length > 50) throw badRequest("Select between 1 and 50 invoices.");
  const scope = await customerScopeFor(actor);
  const access = await getSetting("customerAccess");
  const invoices = await prisma.invoice.findMany({
    where: { AND: [{ id: { in: invoiceIds } }, invoiceScopedWhere(scope)] },
    orderBy: [{ dueDate: "asc" }, { invoiceNumber: "asc" }],
  });
  if (invoices.length !== new Set(invoiceIds).size) throw notFound("One or more invoices were not found.");
  const orgIds = new Set(invoices.map((i) => i.organizationId));
  if (orgIds.size !== 1) throw badRequest("Invoices from different accounts must be paid separately.");
  const organizationId = invoices[0]!.organizationId;
  if (!canPayForOrg(scope, organizationId, access.readOnlyCanPay)) throw badRequest("Your user role does not allow payments. Ask your organization admin.");
  for (const inv of invoices) {
    if (!PAYABLE.includes(inv.status as (typeof PAYABLE)[number]) || inv.balanceCents <= 0) throw badRequest(`Invoice ${inv.invoiceNumber} is not payable.`);
  }
  // Block double-payment while another payment for these invoices is still in flight.
  const inflight = await prisma.paymentAllocation.findFirst({
    where: { invoiceId: { in: invoiceIds }, payment: { status: "PROCESSING" } },
    include: { invoice: { select: { invoiceNumber: true } } },
  });
  if (inflight) throw badRequest(`A bank payment for ${inflight.invoice.invoiceNumber} is still processing.`);

  const totalBalance = invoices.reduce((s, i) => s + i.balanceCents, 0);
  const amount = requestedAmountCents ?? totalBalance;
  if (amount < 50) throw badRequest("The minimum online payment is $0.50.");
  const allocations = allocatePayment(
    amount,
    invoices.map((i) => ({ invoiceId: i.id, balanceCents: i.balanceCents, allowPartial: i.allowPartial })),
  );

  const s = await stripe();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const payment = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.create({
      data: {
        paymentNumber: await numbers.payment(tx),
        organizationId,
        method: "CARD",
        status: "PENDING",
        amountCents: amount,
        initiatedById: actor.userId,
        allocations: { create: allocations.map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amountCents })) },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "payment.checkout_start", entityType: "Payment", entityId: p.id, organizationId, after: { amount, allocations } });
    return p;
  });

  let customerId = org.stripeCustomerId;
  if (!customerId) {
    const c = await s.customers.create({ name: org.name, email: org.primaryEmail ?? undefined, metadata: { organizationId: org.id, accountNumber: org.accountNumber } }, { idempotencyKey: `customer:${org.id}` });
    customerId = c.id;
    await prisma.organization.update({ where: { id: org.id }, data: { stripeCustomerId: customerId } });
  }

  const methods: Stripe.Checkout.SessionCreateParams.AllowedPaymentMethodType[] = ["card"];
  if (env().STRIPE_ENABLE_ACH === "true") methods.push("us_bank_account");
  const names = invoices.filter((i) => allocations.some((a) => a.invoiceId === i.id)).map((i) => i.invoiceNumber);
  const session = await s.checkout.sessions.create(
    {
      mode: "payment",
      customer: customerId,
      allowed_payment_method_types: methods,
      line_items: [
        {
          quantity: 1,
          price_data: { currency: "usd", unit_amount: amount, product_data: { name: names.length === 1 ? `Invoice ${names[0]}` : `${names.length} invoices`, description: names.join(", ").slice(0, 300) } },
        },
      ],
      payment_intent_data: { metadata: { paymentId: payment.id, organizationId } },
      // Customers may opt in to saving a card/bank account with Stripe for future payments.
      saved_payment_method_options: { payment_method_save: "enabled" },
      metadata: { paymentId: payment.id, organizationId },
      client_reference_id: payment.id,
      success_url: `${env().APP_URL}/customer/payments/return?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env().APP_URL}/customer/invoices?cancelled=1`,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
    },
    { idempotencyKey: `checkout:${payment.id}` },
  );
  await prisma.payment.update({ where: { id: payment.id }, data: { stripeCheckoutSessionId: session.id, idempotencyKey: `checkout:${payment.id}` } });
  if (!session.url) throw badRequest("Stripe did not return a checkout URL.");
  return { url: session.url, paymentId: payment.id };
}

/** Read-only status for the post-checkout return page. Never changes balances. */
export async function checkoutReturnStatus(actor: Actor, sessionId: string) {
  const p = await prisma.payment.findUnique({ where: { stripeCheckoutSessionId: sessionId }, include: { allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } } } });
  if (!p) return null;
  const scope = await customerScopeFor(actor);
  if (!scope.orgIds.includes(p.organizationId)) return null;
  return p;
}

// ── Webhooks ────────────────────────────────────────────────────────────────

export async function constructWebhookEvent(rawBody: string, signature: string | null): Promise<Stripe.Event> {
  if (!signature) throw badRequest("Missing Stripe-Signature header.");
  const s = await stripe();
  return s.webhooks.constructEvent(rawBody, signature, env().STRIPE_WEBHOOK_SECRET!);
}

/**
 * Idempotent webhook processing. Each Stripe event id is recorded; replays of an already
 * processed event are acknowledged without side effects. Settlement itself is also guarded per
 * allocation, so even two different events for one payment cannot double-apply.
 */
export async function handleStripeEvent(event: Stripe.Event): Promise<"processed" | "duplicate" | "ignored"> {
  const existing = await prisma.stripeEvent.findUnique({ where: { eventId: event.id } });
  if (existing?.processedAt) return "duplicate";
  if (!existing) {
    try {
      await prisma.stripeEvent.create({ data: { eventId: event.id, type: event.type, livemode: event.livemode } });
    } catch {
      // Concurrent delivery of the same event; the other worker will process it.
      return "duplicate";
    }
  }
  try {
    const handled = await dispatchEvent(event);
    await prisma.stripeEvent.update({ where: { eventId: event.id }, data: { processedAt: new Date(), error: null } });
    return handled ? "processed" : "ignored";
  } catch (err) {
    await prisma.stripeEvent.update({ where: { eventId: event.id }, data: { error: err instanceof Error ? err.message.slice(0, 500) : String(err) } });
    throw err; // non-2xx → Stripe retries
  }
}

async function dispatchEvent(event: Stripe.Event): Promise<boolean> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const payment = await paymentForSession(session);
      if (!payment) return false;
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      if (session.payment_status === "paid") {
        await settlePayment(payment.id, { amountTotal: session.amount_total, paymentIntentId: pi, method: await detectMethod(pi) });
      } else {
        // Asynchronous methods (ACH) — funds not yet settled.
        await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "PROCESSING", method: "ACH", stripePaymentIntentId: pi } });
      }
      return true;
    }
    case "checkout.session.async_payment_succeeded": {
      const session = event.data.object as Stripe.Checkout.Session;
      const payment = await paymentForSession(session);
      if (!payment) return false;
      const pi = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null;
      await settlePayment(payment.id, { amountTotal: session.amount_total, paymentIntentId: pi, method: "ACH" });
      return true;
    }
    case "checkout.session.async_payment_failed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const payment = await paymentForSession(session);
      if (!payment) return false;
      await failPayment(payment.id, "Bank payment failed.");
      return true;
    }
    case "checkout.session.expired": {
      const session = event.data.object as Stripe.Checkout.Session;
      const payment = await paymentForSession(session);
      if (!payment) return false;
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "CANCELLED" } });
      return true;
    }
    case "payment_intent.payment_failed": {
      const pi = event.data.object as Stripe.PaymentIntent;
      const paymentId = pi.metadata?.paymentId;
      if (!paymentId) return false;
      await failPayment(paymentId, pi.last_payment_error?.message ?? "Payment failed.");
      return true;
    }
    case "charge.refunded": {
      const charge = event.data.object as Stripe.Charge;
      const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
      if (!pi) return false;
      await syncRefundTotal(pi, charge.amount_refunded);
      return true;
    }
    case "charge.dispute.created": {
      const dispute = event.data.object as Stripe.Dispute;
      const pi = typeof dispute.payment_intent === "string" ? dispute.payment_intent : dispute.payment_intent?.id;
      if (!pi) return false;
      const p = await prisma.payment.findUnique({ where: { stripePaymentIntentId: pi } });
      if (!p) return false;
      await prisma.$transaction(async (tx) => {
        await tx.payment.update({ where: { id: p.id }, data: { status: "DISPUTED", notes: `Dispute ${dispute.id}: ${dispute.reason}` } });
        await audit(tx, { action: "payment.disputed", entityType: "Payment", entityId: p.id, organizationId: p.organizationId, after: { disputeId: dispute.id, reason: dispute.reason, amount: dispute.amount } });
        await notify(tx, { userIds: await staffWithPermission(tx, "payments.refund"), type: "admin.payment_failed", title: `Payment ${p.paymentNumber} disputed`, body: `${formatCents(dispute.amount)} — reason: ${dispute.reason}. Review in Stripe.`, link: `/admin/payments/${p.id}`, entityType: "Payment", entityId: p.id, dedupeKey: `payment:${p.id}:dispute:${dispute.id}` });
      });
      return true;
    }
    default:
      return false;
  }
}

async function detectMethod(paymentIntentId: string | null): Promise<"CARD" | "ACH"> {
  if (!paymentIntentId) return "CARD";
  try {
    const pi = await (await stripe()).paymentIntents.retrieve(paymentIntentId);
    return pi.payment_method_types.includes("us_bank_account") && !pi.payment_method_types.includes("card") ? "ACH" : "CARD";
  } catch {
    return "CARD";
  }
}

async function paymentForSession(session: Stripe.Checkout.Session) {
  const id = session.metadata?.paymentId ?? session.client_reference_id;
  const byId = id ? await prisma.payment.findUnique({ where: { id } }) : null;
  const p = byId ?? (await prisma.payment.findUnique({ where: { stripeCheckoutSessionId: session.id } }));
  if (!p) logger.warn("stripe.unknown_session", { sessionId: session.id });
  return p;
}

/** Mark a payment succeeded and apply its allocations exactly once. */
export async function settlePayment(paymentId: string, info: { amountTotal: number | null; paymentIntentId: string | null; method: "CARD" | "ACH" | "CHECK" | "CASH" | "OTHER"; actorId?: string | null }) {
  const result = await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
    if (info.amountTotal !== null && info.amountTotal !== p.amountCents) {
      throw new Error(`Amount mismatch for payment ${p.paymentNumber}: expected ${p.amountCents}, received ${info.amountTotal}`);
    }
    if (p.status === "SUCCEEDED" || p.status === "REFUNDED" || p.status === "PARTIALLY_REFUNDED") {
      // Already settled; still make sure every allocation is applied (safe no-op).
      for (const a of p.allocations) await applyAllocation(tx, a.id);
      return { p, newlySettled: false };
    }
    await tx.payment.update({ where: { id: p.id }, data: { status: "SUCCEEDED", receivedAt: new Date(), method: info.method, stripePaymentIntentId: info.paymentIntentId ?? p.stripePaymentIntentId, failureReason: null } });
    for (const a of p.allocations) await applyAllocation(tx, a.id);
    await audit(tx, { actorId: info.actorId ?? null, action: "payment.settled", entityType: "Payment", entityId: p.id, organizationId: p.organizationId, after: { amountCents: p.amountCents, allocations: p.allocations.map((a) => ({ invoiceId: a.invoiceId, amountCents: a.amountCents })) } });
    return { p, newlySettled: true };
  });
  if (result.newlySettled) {
    await prisma.$transaction(async (tx) => {
      const { renderReceiptPdf } = await import("../pdf/invoice-pdf");
      const p = result.p;
      const firstInvoice = await tx.invoice.findUnique({ where: { id: p.allocations[0]!.invoiceId } });
      await storeDocument(tx, {
        bytes: await renderReceiptPdf(tx, p.id),
        fileName: `${p.paymentNumber}-receipt.pdf`,
        title: `Receipt ${p.paymentNumber}`,
        type: "RECEIPT",
        visibility: "CUSTOMER",
        organizationId: p.organizationId,
        locationId: firstInvoice?.serviceLocationId ?? firstInvoice?.billingLocationId ?? null,
        invoiceId: p.allocations.length === 1 ? p.allocations[0]!.invoiceId : null,
        paymentId: p.id,
        uploadedById: null,
        trusted: { mime: "application/pdf", ext: "pdf" },
      });
      const recipients = new Set<string>();
      if (p.initiatedById) recipients.add(p.initiatedById);
      for (const id of await customerRecipientsForLocation(tx, p.organizationId, firstInvoice?.serviceLocationId ?? null)) recipients.add(id);
      await notify(tx, { userIds: [...recipients], type: "payment.received", title: `Payment received — ${formatCents(p.amountCents)}`, body: `Thank you. Payment ${p.paymentNumber} has been applied to your account. Your receipt is available in the portal.`, link: `/customer/payments`, entityType: "Payment", entityId: p.id, dedupeKey: `payment:${p.id}:received` });
    }, { timeout: 30_000 });
  }
  return result.p;
}

async function failPayment(paymentId: string, reason: string) {
  await prisma.$transaction(async (tx) => {
    const p = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!p || p.status === "SUCCEEDED" || p.status === "FAILED") return;
    await tx.payment.update({ where: { id: p.id }, data: { status: "FAILED", failureReason: reason } });
    await audit(tx, { action: "payment.failed", entityType: "Payment", entityId: p.id, organizationId: p.organizationId, reason });
    if (p.initiatedById) await notify(tx, { userIds: [p.initiatedById], type: "payment.failed", title: "Your payment did not go through", body: `${formatCents(p.amountCents)} — ${reason} Your invoices remain open; you can try again from the portal.`, link: "/customer/invoices", entityType: "Payment", entityId: p.id, dedupeKey: `payment:${p.id}:failed` });
    await notify(tx, { userIds: await staffWithPermission(tx, "payments.read"), type: "admin.payment_failed", title: `Payment ${p.paymentNumber} failed`, body: reason, link: `/admin/payments/${p.id}`, entityType: "Payment", entityId: p.id, dedupeKey: `payment:${p.id}:failed` });
  });
}

/**
 * Bring local refund state in line with Stripe's cumulative refunded amount (`charge.amount_refunded`)
 * and reverse the corresponding invoice credit (newest allocations first). Only the difference from
 * what is already recorded is applied, under a row lock, so replays and concurrent deliveries are
 * no-ops. Pending refunds requested here are confirmed oldest first; any remainder was issued
 * directly in the Stripe dashboard and is recorded as its own refund.
 */
export async function syncRefundTotal(paymentIntentId: string, totalRefundedCents: number) {
  return prisma.$transaction(async (tx) => {
    const found = await tx.payment.findUnique({ where: { stripePaymentIntentId: paymentIntentId }, select: { id: true } });
    if (!found) return false;
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${found.id}::uuid FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: found.id }, include: { allocations: { orderBy: { createdAt: "desc" } } } });
    const total = Math.min(totalRefundedCents, p.amountCents);
    const delta = total - p.refundedCents;
    if (delta <= 0) return false;

    let left = delta;
    const pending = await tx.refund.findMany({ where: { paymentId: p.id, status: "PENDING" }, orderBy: { createdAt: "asc" } });
    for (const r of pending) {
      if (r.amountCents > left) break;
      await tx.refund.update({ where: { id: r.id }, data: { status: "SUCCEEDED" } });
      left -= r.amountCents;
    }
    if (left > 0) await tx.refund.create({ data: { paymentId: p.id, amountCents: left, status: "SUCCEEDED", reason: "Issued in the Stripe dashboard" } });

    await reverseAcrossAllocations(tx, p.allocations, delta);
    await tx.payment.update({ where: { id: p.id }, data: { refundedCents: total, status: total >= p.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await audit(tx, { action: "payment.refund_synced", entityType: "Payment", entityId: p.id, organizationId: p.organizationId, before: { refundedCents: p.refundedCents }, after: { refundedCents: total, delta, externalCents: left } });
    if (p.initiatedById) await notify(tx, { userIds: [p.initiatedById], type: "payment.refunded", title: "Refund issued", body: `${formatCents(delta)} was refunded to your original payment method. It can take 5–10 business days to appear.`, link: "/customer/payments", entityType: "Payment", entityId: p.id, dedupeKey: `payment:${p.id}:refund:${total}` });
    return true;
  });
}

async function reverseAcrossAllocations(tx: Db, allocations: { invoiceId: string; amountCents: number; applied: boolean }[], amount: number) {
  let remaining = amount;
  for (const a of allocations) {
    if (remaining <= 0) break;
    if (!a.applied) continue;
    const take = Math.min(remaining, a.amountCents);
    await reverseAllocation(tx, a.invoiceId, take);
    remaining -= take;
  }
}

// ── Staff operations ─────────────────────────────────────────────────────────

/** Record an offline payment (check, cash, phone). Settles immediately. */
export async function recordManualPayment(actor: Actor, input: { organizationId: string; method: "CHECK" | "CASH" | "OTHER"; amountCents: number; reference?: string; invoiceIds: string[]; notes?: string }) {
  assertStaffActor(actor, "payments.record");
  const invoices = await prisma.invoice.findMany({ where: { id: { in: input.invoiceIds }, organizationId: input.organizationId }, orderBy: { dueDate: "asc" } });
  if (invoices.length !== input.invoiceIds.length) throw notFound("Invoice not found for this customer.");
  if (invoices.some((i) => !PAYABLE.includes(i.status as (typeof PAYABLE)[number]))) throw badRequest("All selected invoices must be open.");
  const allocations = allocatePayment(input.amountCents, invoices.map((i) => ({ invoiceId: i.id, balanceCents: i.balanceCents, allowPartial: true })));
  const p = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        paymentNumber: await numbers.payment(tx),
        organizationId: input.organizationId,
        method: input.method,
        status: "PENDING",
        amountCents: input.amountCents,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        recordedById: actor.userId,
        allocations: { create: allocations },
      },
    });
    await audit(tx, { actorId: actor.userId, action: "payment.record_manual", entityType: "Payment", entityId: payment.id, organizationId: input.organizationId, after: input });
    return payment;
  });
  return settlePayment(p.id, { amountTotal: input.amountCents, paymentIntentId: null, method: input.method, actorId: actor.userId });
}

export async function refundPayment(actor: Actor, paymentId: string, amountCents: number, reason: string) {
  assertStaffActor(actor, "payments.refund");
  if (reason.trim().length < 3) throw badRequest("A reason is required.");
  const p = await prisma.payment.findUnique({ where: { id: paymentId }, include: { allocations: { orderBy: { createdAt: "desc" } } } });
  if (!p) throw notFound();
  if (!["SUCCEEDED", "PARTIALLY_REFUNDED"].includes(p.status)) throw badRequest("Only settled payments can be refunded.");
  const pendingCents = (await prisma.refund.aggregate({ where: { paymentId, status: "PENDING" }, _sum: { amountCents: true } }))._sum.amountCents ?? 0;
  if (!Number.isInteger(amountCents) || amountCents <= 0 || amountCents > p.amountCents - p.refundedCents - pendingCents) throw badRequest("Refund amount exceeds the refundable balance (including refunds still processing).");

  const refund = await prisma.$transaction(async (tx) => {
    const r = await tx.refund.create({ data: { paymentId, amountCents, reason, createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "payment.refund_requested", entityType: "Payment", entityId: paymentId, organizationId: p.organizationId, after: { amountCents }, reason });
    return r;
  });

  if (p.stripePaymentIntentId) {
    const s = await stripe();
    let sr: Stripe.Refund;
    try {
      sr = await s.refunds.create({ payment_intent: p.stripePaymentIntentId, amount: amountCents, reason: "requested_by_customer", metadata: { refundId: refund.id } }, { idempotencyKey: `refund:${refund.id}` });
    } catch (err) {
      await prisma.refund.update({ where: { id: refund.id }, data: { status: "FAILED" } });
      throw err;
    }
    // Don't write status here: the charge.refunded webhook may already have confirmed it.
    await prisma.refund.update({ where: { id: refund.id }, data: { stripeRefundId: sr.id } });
    if (sr.status === "failed" || sr.status === "canceled") await prisma.refund.updateMany({ where: { id: refund.id, status: "PENDING" }, data: { status: "FAILED" } });
    // Balance reversal happens when Stripe confirms via charge.refunded.
    return { refundId: refund.id, pending: true };
  }
  // Offline payment: the refund is issued outside the platform; record it now.
  await prisma.$transaction(async (tx) => {
    await reverseAcrossAllocations(tx, p.allocations, amountCents);
    const total = p.refundedCents + amountCents;
    await tx.payment.update({ where: { id: p.id }, data: { refundedCents: total, status: total >= p.amountCents ? "REFUNDED" : "PARTIALLY_REFUNDED" } });
    await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED" } });
  });
  return { refundId: refund.id, pending: false };
}
