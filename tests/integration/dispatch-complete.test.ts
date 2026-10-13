import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "Sewer Squad <office@sewersquadservices.com>";
  process.env.RESEND_INBOUND_WEBHOOK_SECRET = `whsec_${Buffer.from("inbound-secret-0123456789").toString("base64")}`;
});

import { createHmac } from "node:crypto";
import { prisma, resetDb, seedRbac, staff, PNG, SIGNATURE, today } from "./helpers";
import { createCustomerWithService, newCustomerSchema } from "@/server/services/onboarding";
import { completeJobFromBoard, completeJobSchema } from "@/server/services/job-completion";
import { sharedJob } from "@/server/services/job-share";
import { jobShareToken, verifyJobShareToken } from "@/server/share";
import { extractFields, ingestInboundEmail, leadStats, logLeadContact, parseAddress, verifyResendWebhook } from "@/server/services/leads";
import { grossProfitByMonth } from "@/server/services/analytics";
import { addDays, keyFromDate } from "@/lib/dates";

type Sent = { url: string; body: Record<string, unknown> };
function stubFetch(received: Record<string, unknown> = {}) {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/emails/receiving/")) {
      const id = url.split("/").pop()!;
      return new Response(JSON.stringify(received[id]), { status: received[id] ? 200 : 404 });
    }
    sent.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(JSON.stringify({ id: `em_${sent.length}` }), { status: 200 });
  }));
  return sent;
}

describe("New Customer → dispatch board → Completed", () => {
  let admin: Awaited<ReturnType<typeof staff>>;
  let orgId: string;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    await prisma.companySetting.create({ data: { key: "company", value: { name: "Sewer Squad Services LLC", phone: "346-244-5579", email: "sales@sewersquadservices.com" } } });
    admin = await staff("super_admin");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("adds a multi-unit customer and schedules each location in one step (recurring is the default)", async () => {
    const input = newCustomerSchema.parse({
      name: "Taco Town",
      contactName: "Ana Ruiz",
      email: "Ana@TacoTown.test",
      phone: "713-555-0110",
      smsOptIn: true,
      smsOptInSource: "Verbal, on the phone",
      multiUnit: true,
      locations: [
        { name: "Heights", addressLine1: "100 Yale St", city: "Houston", postalCode: "77008", trapGallons: 1000, date: today(), price: "0.89", manifestFee: "CITY_OF_HOUSTON" },
        { name: "Midtown", addressLine1: "200 Main St", city: "Houston", postalCode: "77002", jobType: "ONE_TIME", pricingModel: "FLAT_RATE", price: "350", date: addDays(today(), 10) },
      ],
    });
    expect(input.locations[0]!.jobType).toBe("RECURRING");
    const res = await createCustomerWithService(admin, input);
    orgId = res.organizationId;
    const locs = await prisma.serviceLocation.findMany({ where: { organizationId: orgId }, orderBy: { name: "asc" }, include: { jobs: true, plans: true, assets: true } });
    expect(locs.map((l) => l.name)).toEqual(["Taco Town — Heights", "Taco Town — Midtown"]);
    expect(locs[0]!.plans).toHaveLength(1);
    expect(locs[0]!.plans[0]!.recurrenceRuleId).toBeTruthy();
    expect(locs[0]!.jobs.map((j) => [j.type, keyFromDate(j.scheduledDate)])).toEqual([["RECURRING", today()]]);
    expect(locs[1]!.jobs.map((j) => [j.type, j.quotedPriceCents])).toEqual([["ONE_TIME", 35000]]);
    const contact = await prisma.customerContact.findFirstOrThrow({ where: { organizationId: orgId } });
    expect([contact.email, contact.isPrimary, contact.receivesInvoices, contact.smsOptIn]).toEqual(["ana@tacotown.test", true, true, true]);
    await expect(createCustomerWithService(admin, input)).rejects.toThrow(/already exists/);
  });

  it("Completed finalizes the manifest, sends the invoice, and emails + texts the customer their paperwork", async () => {
    const job = await prisma.job.findFirstOrThrow({ where: { organizationId: orgId, type: "RECURRING" }, include: { assets: true } });
    const sent = stubFetch();
    const input = completeJobSchema.parse({ jobId: job.id, "assetIds": [job.assets[0]!.assetId], assetGallons: ["750"], customerSignerName: "Ana Ruiz", customerSignature: SIGNATURE, driverSignature: SIGNATURE, certify: "on" });
    const res = await completeJobFromBoard(admin, input, [{ bytes: PNG, name: "after.png", phase: "AFTER" }, { bytes: PNG, name: "coh.png", phase: "CITY_MANIFEST" }], { ip: "127.0.0.1" });

    const done = await prisma.job.findUniqueOrThrow({ where: { id: job.id }, include: { manifest: true, invoices: { include: { lineItems: true } }, driver: true } });
    expect(done.status).toBe("COMPLETED");
    expect(done.manifest!.status).toBe("FINALIZED");
    expect(done.driver!.userId).toBe(admin.userId); // owner's field profile, created automatically
    const truck = await prisma.vehicle.findFirstOrThrow();
    expect(truck.tankCapacityGallons).toBe(2500);
    const inv = done.invoices[0]!;
    expect(inv.status).toBe("SENT");
    expect(inv.lineItems.find((l) => l.kind === "PER_GALLON")!.amountCents).toBe(66750); // 750 × $0.89
    expect(inv.lineItems.some((l) => l.kind === "MANIFEST_FEE")).toBe(true);
    expect(res).toMatchObject({ invoiceSent: true, invoiceNumber: inv.invoiceNumber, emailedTo: ["ana@tacotown.test"], texted: 1, problems: [] });

    const email = sent.find((s) => s.url.includes("api.resend.com/emails"))!.body as { to: string[]; subject: string; text: string; attachments: { filename: string }[]; reply_to: string };
    expect(email.to).toEqual(["ana@tacotown.test"]);
    expect(email.reply_to).toBe("sales@sewersquadservices.com");
    expect(email.attachments.map((a) => a.filename)).toEqual(expect.arrayContaining([expect.stringMatching(/^Manifest /), `Invoice ${inv.invoiceNumber}.pdf`, "After photo 1.png"]));
    const link = /http:\/\/localhost:3000\/s\/(\S+)/.exec(email.text)![1]!;

    // Only one message about the invoice: the completion email, not a separate invoice notice.
    const text = await prisma.contactText.findMany({ where: { organizationId: orgId } });
    expect(text.map((t) => t.type)).toEqual(expect.arrayContaining(["service.completed"]));
    expect(text.some((t) => t.type === "invoice.issued")).toBe(false);
    expect(text.find((t) => t.type === "service.completed")!.body).toContain(`/s/${link}`);

    // The link shows the paperwork without a login; the next visit is scheduled 90 days out.
    const shared = await sharedJob(link);
    expect(shared!.docs.map((d) => d.type).sort()).toEqual(["INVOICE", "MANIFEST", "MANIFEST_OFFICIAL", "SERVICE_PHOTO"]);
    const plan = await prisma.servicePlan.findUniqueOrThrow({ where: { id: done.planId! } });
    expect(keyFromDate(plan.nextServiceDate!)).toBe(addDays(today(), 90));
    await expect(completeJobFromBoard(admin, input, [], { ip: null })).rejects.toThrow(/already completed/);
  });

  it("share links are signed and expire", () => {
    const id = "6f1c2d3e-4a5b-4c6d-8e9f-0a1b2c3d4e5f";
    const t = jobShareToken(id);
    expect(verifyJobShareToken(t)).toBe(id);
    expect(verifyJobShareToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBeNull();
    expect(verifyJobShareToken(jobShareToken(id, -1))).toBeNull();
  });

  it("gross profit subtracts disposal at the average cost per gallon", async () => {
    const facility = await prisma.disposalFacility.create({ data: { name: "LES", addressLine1: "250 Gellhorn Dr", city: "Houston", state: "TX", postalCode: "77013" } });
    await prisma.disposalBill.create({ data: { facilityId: facility.id, vendorInvoiceNumber: "X1", invoiceDate: new Date(), totalCents: 18500, lines: { create: { description: "Grease", gallons: 1000, amountCents: 18500 } } } });
    const p = await grossProfitByMonth(2);
    expect(p.centsPerGallon).toBeCloseTo(18.5);
    const m = p.months[0]!;
    expect(m.gallons).toBe(750);
    expect(m.disposalCents).toBe(13875);
    expect(m.profitCents).toBe(m.revenueCents - 13875);
  });
});

describe("leads from the Gmail and sales@ inboxes", () => {
  let admin: Awaited<ReturnType<typeof staff>>;
  beforeAll(async () => {
    admin = await staff("admin");
  });
  afterEach(() => vi.unstubAllGlobals());

  const mail = (id: string, over: Record<string, unknown>) => ({ id, from: "x@y.test", to: ["sewersquadservices@gmail.com"], cc: [], bcc: [], reply_to: [], received_for: ["leads@abc.resend.app"], subject: "Quote", text: "", html: null, created_at: new Date(Date.now() - 2 * 3600_000).toISOString(), message_id: `<${id}@mail>`, headers: {}, ...over });

  it("verifies Resend's webhook signature", () => {
    const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET!;
    const body = JSON.stringify({ type: "email.received", data: { email_id: "e1" } });
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`msg_1.${ts}.${body}`).digest("base64");
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret)).toBe(true);
    expect(verifyResendWebhook(body + " ", { id: "msg_1", timestamp: ts, signature: `v1,${sig}` }, secret)).toBe(false);
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: String(Number(ts) - 3600), signature: `v1,${sig}` }, secret)).toBe(false);
  });

  it("parses senders and website-form fields", () => {
    expect(parseAddress('"Jane Doe" <Jane@X.com>')).toEqual({ name: "Jane Doe", email: "jane@x.com" });
    expect(extractFields("Name: Bob Lee\nPhone: (281) 555-0199\nBusiness: Bob's BBQ\nMessage: need pumping")).toEqual({ name: "Bob Lee", email: null, phone: "(281) 555-0199", company: "Bob's BBQ" });
  });

  it("turns a forwarded email into a lead, joins follow-ups, and times the first contact", async () => {
    stubFetch({
      e1: mail("e1", { from: "sewersquadservices@gmail.com", headers: { from: "Sewer Squad <sewersquadservices@gmail.com>" }, subject: "Fwd: Grease trap quote", text: "---------- Forwarded message ---------\nFrom: Maria Lopez <maria@cafe.test>\nDate: Mon\nSubject: Grease trap quote\nTo: <sewersquadservices@gmail.com>\n\nHi, can you pump our 1000 gal trap? Call 713-555-0142." }),
      e2: mail("e2", { from: "maria@cafe.test", headers: { from: "Maria Lopez <maria@cafe.test>" }, subject: "Re: quote", text: "Any update?\n\nOn Mon, Sewer Squad wrote:\n> old" }),
      e3: mail("e3", { from: "sales@sewersquadservices.com", headers: { from: "sales@sewersquadservices.com" }, to: ["maria@cafe.test"], subject: "Re: quote", text: "Hi Maria, $0.89/gal." }),
    });
    const a = await ingestInboundEmail("e1");
    expect(a.kind).toBe("lead");
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: (a as { leadId: string }).leadId } });
    expect([lead.name, lead.email, lead.phone, lead.inbox, lead.subject, lead.status]).toEqual(["Maria Lopez", "maria@cafe.test", "713-555-0142", "sewersquadservices@gmail.com", "Grease trap quote", "NEW"]);
    expect(await ingestInboundEmail("e1")).toEqual({ kind: "duplicate" });
    expect((await leadStats()).uncontacted).toBe(1);

    expect(await ingestInboundEmail("e2")).toMatchObject({ kind: "followup", leadId: lead.id });
    expect(await ingestInboundEmail("e3")).toMatchObject({ kind: "reply-logged", leadId: lead.id });
    const after = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { activities: true } });
    expect([after.status, after.firstContactMethod]).toEqual(["CONTACTED", "email"]);
    expect(after.activities.map((x) => x.kind).sort()).toEqual(["email_in", "email_in", "email_out"]);

    // A later call doesn't change the first-contact time.
    await logLeadContact(admin, lead.id, "call");
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).firstContactedAt).toEqual(after.firstContactedAt);
  });
});
