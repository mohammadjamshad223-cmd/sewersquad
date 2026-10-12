import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.TWILIO_ACCOUNT_SID = "AC_test";
  process.env.TWILIO_AUTH_TOKEN = "test-token";
  process.env.TWILIO_MESSAGING_SERVICE_SID = "MG_test";
});

import { prisma, resetDb, seedRbac, staff, org, expectCode, today } from "./helpers";
import { createJob, jobSchema } from "@/server/services/jobs";
import { notify, processDueDeliveries } from "@/server/services/notifications";
import { contactSchema, upsertContact } from "@/server/services/customers";
import { addDays } from "@/lib/dates";

function twilio(response: { status: number; body: unknown }) {
  const calls: URLSearchParams[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
    calls.push(new URLSearchParams(String(init.body)));
    return new Response(JSON.stringify(response.body), { status: response.status });
  }));
  return calls;
}

describe("text message updates to customer contacts", () => {
  let admin: Awaited<ReturnType<typeof staff>>, A: Awaited<ReturnType<typeof org>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    await prisma.companySetting.create({ data: { key: "company", value: { name: "Sewer Squad Services LLC", phone: "346-244-5579" } } });
    admin = await staff("admin");
    A = await org("Ghost Bar", { locations: 2 });
    const save = (input: object) => upsertContact(admin, A.org.id, null, contactSchema.parse(input));
    await save({ name: "Manager", phone: "713-555-0100", receivesReminders: true, smsOptIn: true, smsOptInSource: "Verbal on site", locationId: A.locations[0]!.id });
    await save({ name: "Owner (email only)", phone: "713-555-0101", receivesReminders: true });
    await save({ name: "Other site", phone: "713-555-0102", receivesReminders: true, smsOptIn: true, smsOptInSource: "Signed form", locationId: A.locations[1]!.id });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("requires a mobile number and a consent note before texting", async () => {
    expect(() => contactSchema.parse({ name: "No phone", smsOptIn: true, smsOptInSource: "Verbal" })).toThrow(/mobile number/);
    expect(() => contactSchema.parse({ name: "No consent", phone: "713-555-0199", smsOptIn: true })).toThrow(/how they agreed/i);
    const c = await prisma.customerContact.findFirstOrThrow({ where: { name: "Manager" } });
    expect(c.smsOptInAt).toBeTruthy();
  });

  it("texts only opted-in contacts for that location, through the Messaging Service", async () => {
    await createJob(admin, jobSchema.parse({ locationId: A.locations[0]!.id, serviceType: "GREASE_TRAP_PUMPING", scheduledDate: addDays(today(), 5) }));
    const queued = await prisma.contactText.findMany({ include: { contact: true } });
    expect(queued.map((t) => t.contact.name)).toEqual(["Manager"]);
    expect(queued[0]!.body).toMatch(/^Sewer Squad: Service scheduled for Ghost Bar #1\. .*Questions\? Call 346-244-5579\. Reply STOP to opt out\.$/);

    const calls = twilio({ status: 201, body: { sid: "SM123" } });
    await processDueDeliveries();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.get("To")).toBe("+17135550100");
    expect(calls[0]!.get("MessagingServiceSid")).toBe("MG_test");
    expect(calls[0]!.get("From")).toBeNull();
    const sent = await prisma.contactText.findFirstOrThrow({ where: { id: queued[0]!.id } });
    expect([sent.status, sent.providerMessageId]).toEqual(["SENT", "SM123"]);
  });

  it("a STOP reply (Twilio 21610) turns texting off for that contact", async () => {
    await notify(prisma, { userIds: [], contacts: { organizationId: A.org.id, locationId: A.locations[0]!.id }, type: "service.reminder", title: "Reminder", body: "Service tomorrow.", dedupeKey: "r1" });
    twilio({ status: 400, body: { code: 21610, message: "Attempt to send to unsubscribed recipient" } });
    await processDueDeliveries();
    const contact = await prisma.customerContact.findFirstOrThrow({ where: { name: "Manager" } });
    expect(contact.smsOptedOutAt).toBeTruthy();
    expect((await prisma.contactText.findFirstOrThrow({ where: { dedupeKey: "r1" } })).status).toBe("FAILED");
    await notify(prisma, { userIds: [], contacts: { organizationId: A.org.id, locationId: A.locations[0]!.id }, type: "service.reminder", title: "Reminder", body: "Again.", dedupeKey: "r2" });
    expect(await prisma.contactText.count({ where: { dedupeKey: "r2" } })).toBe(0);
  });

  it("only staff with customer access can change contacts", async () => {
    await expectCode(upsertContact(await staff("accounting"), A.org.id, null, contactSchema.parse({ name: "Someone", phone: "713-555-0123", smsOptIn: true, smsOptInSource: "Verbal" })), "FORBIDDEN");
  });
});
