import { beforeAll, describe, expect, it, vi } from "vitest";

const KEY = vi.hoisted(() => {
  const k = "agent-test-key-0123456789abcdef0123456789";
  process.env.AGENT_API_KEY = k;
  return k;
});

import { NextRequest } from "next/server";
import { prisma, resetDb, seedRbac, org, sentInvoice, today, job } from "./helpers";
import { GET as invoices, POST as postInvoices } from "@/app/api/v1/invoices/route";
import { GET as jobs } from "@/app/api/v1/jobs/route";
import { GET as customers } from "@/app/api/v1/customers/route";
import { GET as payments } from "@/app/api/v1/payments/route";
import { isAuthorized } from "@/server/api-v1/core";
import { clearRateLimit } from "@/server/auth/rate-limit";
import { addDays, dateFromKey } from "@/lib/dates";

const call = (handler: (r: NextRequest) => Promise<Response>, path: string, auth: string | null = `Bearer ${KEY}`, ip = "10.0.0.1") =>
  handler(new NextRequest(`http://localhost:3000${path}`, { headers: { ...(auth ? { authorization: auth } : {}), "x-forwarded-for": ip } }));

describe("read-only agent API", () => {
  let A: Awaited<ReturnType<typeof org>>, B: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    A = await org("Alpha Grill", { locations: 1 });
    B = await org("Beta Bistro", { locations: 1 });
    const paid = await sentInvoice(A.org.id, A.locations[0]!.id, 66750);
    await prisma.invoice.update({ where: { id: paid.id }, data: { status: "PAID", amountPaidCents: 66750, balanceCents: 0, issueDate: dateFromKey(addDays(today(), -40)), dueDate: dateFromKey(addDays(today(), -10)) } });
    await prisma.invoiceLineItem.create({ data: { invoiceId: paid.id, kind: "PER_GALLON", description: "Pumping", quantity: "750", unitPriceCents: "89", amountCents: 66750 } });
    const overdue = await sentInvoice(B.org.id, B.locations[0]!.id, 35000);
    await prisma.invoice.update({ where: { id: overdue.id }, data: { issueDate: dateFromKey(addDays(today(), -45)), dueDate: dateFromKey(addDays(today(), -15)) } });
    await sentInvoice(B.org.id, B.locations[0]!.id, 12000); // current, unpaid
    await sentInvoice(B.org.id, B.locations[0]!.id, 999, { status: "DRAFT" }); // never listed
    const pay = await prisma.payment.create({ data: { paymentNumber: "PAY-1", organizationId: A.org.id, method: "CHECK", status: "SUCCEEDED", amountCents: 66750, receivedAt: new Date(), allocations: { create: { invoiceId: paid.id, amountCents: 66750, applied: true } } } });
    void pay;
    await job(A.locations[0]!.id, { date: addDays(today(), -3) });
    await job(B.locations[0]!.id, { date: addDays(today(), 7) });
  });

  it("rejects anything without the exact bearer key", async () => {
    for (const auth of [null, "Bearer wrong-key", KEY, `Basic ${KEY}`, `Bearer ${KEY} extra`, `bearer ${KEY}`]) {
      const res = await call(invoices, "/api/v1/invoices", auth);
      expect(res.status).toBe(401);
    }
    expect(isAuthorized(`Bearer short`, "short")).toBe(false); // too-short keys never work
    expect((await postInvoices()).status).toBe(405);
  });

  it("lists invoices with paid / unpaid / overdue filters and customer, date and paging", async () => {
    const all = await (await call(invoices, "/api/v1/invoices")).json();
    expect(all.total).toBe(3); // drafts excluded
    const paid = await (await call(invoices, "/api/v1/invoices?status=paid")).json();
    expect(paid.data).toHaveLength(1);
    expect(paid.data[0]).toMatchObject({ customer: { name: "Alpha Grill" }, gallons: 750, price_per_gallon: 0.89, total: 667.5, amount_paid: 667.5, balance: 0, status: "paid" });
    expect(Object.keys(paid.data[0])).toEqual(expect.arrayContaining(["id", "number", "service_date", "issue_date", "due_date"]));
    expect((await (await call(invoices, "/api/v1/invoices?status=overdue")).json()).data.map((i: { total: number }) => i.total)).toEqual([350]);
    expect((await (await call(invoices, "/api/v1/invoices?status=unpaid")).json()).total).toBe(2);
    expect((await (await call(invoices, `/api/v1/invoices?customer_id=${A.org.id}`)).json()).total).toBe(1);
    expect((await (await call(invoices, `/api/v1/invoices?from=${addDays(today(), -42)}&to=${addDays(today(), -41)}`)).json()).total).toBe(0);
    const page = await (await call(invoices, "/api/v1/invoices?limit=2&page=2")).json();
    expect([page.data.length, page.page, page.limit, page.has_more]).toEqual([1, 2, 2, false]);
    const bad = await call(invoices, "/api/v1/invoices?status=late&limit=500&customer=x");
    expect(bad.status).toBe(400);
    expect(Object.keys((await bad.json()).details)).toEqual(expect.arrayContaining(["status", "limit"]));
  });

  it("lists jobs, customers and payments", async () => {
    const j = await (await call(jobs, "/api/v1/jobs?status=overdue")).json();
    expect(j.data).toHaveLength(1);
    expect(j.data[0]).toMatchObject({ customer: { name: "Alpha Grill" }, address: "100 Main, Houston, TX 77002", service_type: "Grease Interceptor Pumping", status: "scheduled", disposal_site: null });
    expect((await (await call(jobs, `/api/v1/jobs?from=${today()}`)).json()).total).toBe(1);

    const c = await (await call(customers, "/api/v1/customers?status=overdue")).json();
    expect(c.data.map((x: { name: string }) => x.name)).toEqual(["Beta Bistro"]);
    expect(c.data[0]).toMatchObject({ payment_terms: "Net 30", balance: 470, address: "100 Main, Houston, TX 77002" });
    expect(Object.keys(c.data[0])).toEqual(expect.arrayContaining(["contact_name", "phone", "email", "service_frequency", "price_per_gallon"]));

    const p = await (await call(payments, "/api/v1/payments")).json();
    expect(p.data[0]).toMatchObject({ amount: 667.5, method: "check", invoice_id: expect.any(String) });
  });

  it("allows 60 requests a minute", async () => {
    await clearRateLimit("api-v1:" + (await import("node:crypto")).createHash("sha256").update(KEY).digest("hex").slice(0, 16));
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await call(payments, "/api/v1/payments?limit=1")).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    const last = await call(payments, "/api/v1/payments?limit=1");
    expect(last.status).toBe(429);
    expect(last.headers.get("retry-after")).toBe("60");
  });
});
