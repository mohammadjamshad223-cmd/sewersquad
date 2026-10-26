import { afterEach, describe, expect, it, vi } from "vitest";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function load() {
  vi.resetModules();
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "tok");
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", "MG456");
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  return import("@/server/integrations/sms");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function run(responses: Response[]) {
  const { diagnoseSms } = await load();
  const fetchMock = vi.fn(async () => responses.shift()!);
  vi.stubGlobal("fetch", fetchMock);
  const p = diagnoseSms("713-555-0101", "hi");
  await vi.runAllTimersAsync();
  return p;
}

describe("diagnoseSms", () => {
  it("explains a carrier block on an unregistered number (30034)", async () => {
    const steps = await run([json({ compliance: [{ campaign_status: "IN_PROGRESS" }] }), json({ sid: "SM1" }, 201), json({ status: "undelivered", error_code: 30034 })]);
    expect(steps.map((s) => s.ok)).toEqual([true, false, true, false]);
    expect(steps[1]?.detail).toMatch(/in progress/);
    expect(steps[3]?.detail).toMatch(/A2P 10DLC/);
  });

  it("reports delivery when the campaign is approved", async () => {
    const steps = await run([json({ compliance: [{ campaign_status: "VERIFIED" }] }), json({ sid: "SM1" }, 201), json({ status: "delivered" })]);
    expect(steps.every((s) => s.ok)).toBe(true);
  });

  it("stops at bad credentials", async () => {
    const steps = await run([json({ code: 20003 }, 401)]);
    expect(steps.at(-1)).toMatchObject({ ok: false, detail: expect.stringMatching(/Auth Token/) });
  });

  it("translates a send-time error code", async () => {
    const steps = await run([json({ compliance: [] }), json({ code: 21608, message: "unverified" }, 400)]);
    expect(steps.at(-1)).toMatchObject({ label: "Twilio accepts the text", ok: false, detail: expect.stringMatching(/trial/) });
  });
});
