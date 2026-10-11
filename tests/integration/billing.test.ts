import { beforeAll, describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { prisma, resetDb, seedRbac, staff, org, sentInvoice, expectCode } from "./helpers";
import { handleStripeEvent, recordManualPayment, refundPayment, settlePayment } from "@/server/services/payments";
import { voidInvoice, sendInvoiceReminders, refreshOverdueInvoices } from "@/server/services/invoices";
import { addDays, dateFromKey, todayKey } from "@/lib/dates";

async function pendingPayment(organizationId: string, allocations: { invoiceId: string; amountCents: number }[]) {
  return prisma.payment.create({
    data: { paymentNumber: `P-${Math.random().toString(36).slice(2)}`, organizationId, method: "CARD", status: "PENDING", amountCents: allocations.reduce((s, a) => s + a.amountCents, 0), allocations: { create: allocations } },
  });
}

function sessionEvent(id: string, type: string, paymentId: string, amount: number, paymentStatus: "paid" | "unpaid"): Stripe.Event {
  return { id, type, livemode: false, data: { object: { id: `cs_${id}`, object: "checkout.session", metadata: { paymentId }, client_reference_id: paymentId, amount_total: amount, payment_status: paymentStatus, payment_intent: null } } } as unknown as Stripe.Event;
}

describe("payments & invoices", () => {
  let accounting: Awaited<ReturnType<typeof staff>>, A: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    accounting = await staff("accounting");
    A = await org("Billing Co", { locations: 1 });
  });

  it("settles a payment exactly once even when called repeatedly", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 10_000);
    const p = await pendingPayment(A.org.id, [{ invoiceId: inv.id, amountCents: 10_000 }]);
    await settlePayment(p.id, { amountTotal: 10_000, paymentIntentId: null, method: "CARD" });
    await settlePayment(p.id, { amountTotal: 10_000, paymentIntentId: null, method: "CARD" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountPaidCents).toBe(10_000);
    expect(after.balanceCents).toBe(0);
    expect(after.status).toBe("PAID");
    expect(await prisma.document.count({ where: { paymentId: p.id, type: "RECEIPT" } })).toBe(1);
  });

  it("deduplicates Stripe webhook deliveries by event id", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 4_000);
    const p = await pendingPayment(A.org.id, [{ invoiceId: inv.id, amountCents: 4_000 }]);
    const evt = sessionEvent("evt_dup_1", "checkout.session.completed", p.id, 4_000, "paid");
    expect(await handleStripeEvent(evt)).toBe("processed");
    expect(await handleStripeEvent(evt)).toBe("duplicate");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaidCents).toBe(4_000);
  });

  it("ACH: stays processing until async success; balance only changes on settlement", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 6_000);
    const p = await pendingPayment(A.org.id, [{ invoiceId: inv.id, amountCents: 6_000 }]);
    await handleStripeEvent(sessionEvent("evt_ach_1", "checkout.session.completed", p.id, 6_000, "unpaid"));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PROCESSING");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).balanceCents).toBe(6_000);
    await handleStripeEvent(sessionEvent("evt_ach_2", "checkout.session.async_payment_succeeded", p.id, 6_000, "paid"));
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).balanceCents).toBe(0);
  });

  it("failed async payments leave invoices open", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 2_000);
    const p = await pendingPayment(A.org.id, [{ invoiceId: inv.id, amountCents: 2_000 }]);
    await handleStripeEvent(sessionEvent("evt_fail_1", "checkout.session.async_payment_failed", p.id, 2_000, "unpaid"));
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("FAILED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).balanceCents).toBe(2_000);
  });

  it("rejects a settlement whose amount does not match", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 5_000);
    const p = await pendingPayment(A.org.id, [{ invoiceId: inv.id, amountCents: 5_000 }]);
    await expect(settlePayment(p.id, { amountTotal: 4_999, paymentIntentId: null, method: "CARD" })).rejects.toThrow(/mismatch/);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).amountPaidCents).toBe(0);
  });

  it("partial payments across invoices allocate oldest-first and update statuses", async () => {
    const i1 = await sentInvoice(A.org.id, A.locations[0]!.id, 3_000);
    const i2 = await sentInvoice(A.org.id, A.locations[0]!.id, 7_000);
    await prisma.invoice.update({ where: { id: i1.id }, data: { dueDate: dateFromKey(addDays(todayKey(), 5)) } });
    await recordManualPayment(accounting, { organizationId: A.org.id, method: "CHECK", amountCents: 5_000, reference: "#1001", invoiceIds: [i1.id, i2.id] });
    const [a, b] = await Promise.all([prisma.invoice.findUniqueOrThrow({ where: { id: i1.id } }), prisma.invoice.findUniqueOrThrow({ where: { id: i2.id } })]);
    expect([a.status, a.balanceCents]).toEqual(["PAID", 0]);
    expect([b.status, b.balanceCents]).toEqual(["PARTIALLY_PAID", 5_000]);
    await expect(recordManualPayment(accounting, { organizationId: A.org.id, method: "CHECK", amountCents: 6_000, invoiceIds: [i2.id] })).rejects.toThrow(/exceeds/);
  });

  it("refunds reverse the invoice balance; voiding requires no applied payments", async () => {
    const inv = await sentInvoice(A.org.id, A.locations[0]!.id, 8_000);
    const p = await recordManualPayment(accounting, { organizationId: A.org.id, method: "CASH", amountCents: 8_000, invoiceIds: [inv.id] });
    await expectCode(voidInvoice(accounting, inv.id, "Billing error"), "BAD_REQUEST");
    await refundPayment(accounting, p.id, 3_000, "Overcharge");
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.amountPaidCents).toBe(5_000);
    expect(after.balanceCents).toBe(3_000);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("PARTIALLY_REFUNDED");
    await expectCode(refundPayment(accounting, p.id, 6_000, "Too much"), "BAD_REQUEST");
  });

  it("overdue and reminder jobs skip paid and voided invoices", async () => {
    const paid = await sentInvoice(A.org.id, A.locations[0]!.id, 1_000);
    await prisma.invoice.update({ where: { id: paid.id }, data: { status: "PAID", amountPaidCents: 1_000, balanceCents: 0, dueDate: dateFromKey(addDays(todayKey(), -7)) } });
    const voided = await sentInvoice(A.org.id, A.locations[0]!.id, 1_000);
    await prisma.invoice.update({ where: { id: voided.id }, data: { status: "VOID", balanceCents: 0, dueDate: dateFromKey(addDays(todayKey(), -7)) } });
    const late = await sentInvoice(A.org.id, A.locations[0]!.id, 1_000);
    await prisma.invoice.update({ where: { id: late.id }, data: { dueDate: dateFromKey(addDays(todayKey(), -7)) } });
    await refreshOverdueInvoices();
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: late.id } })).status).toBe("OVERDUE");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: paid.id } })).status).toBe("PAID");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: voided.id } })).status).toBe("VOID");
    const admin = await prisma.user.create({ data: { email: "billing-admin@t.test", name: "BA", kind: "CUSTOMER", status: "ACTIVE" } });
    await prisma.organizationMembership.create({ data: { organizationId: A.org.id, userId: admin.id, role: "ORG_ADMIN" } });
    await sendInvoiceReminders();
    await sendInvoiceReminders(); // dedupe
    const notes = await prisma.notification.findMany({ where: { userId: admin.id, type: "invoice.reminder" } });
    expect(notes.map((n) => n.entityId)).toEqual([late.id]);
  });
});
