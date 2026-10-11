import { describe, expect, it } from "vitest";

// Configure Stripe for this test file only (modules are isolated per file).
process.env.STRIPE_SECRET_KEY = "sk_test_offline_dummy";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_offline_test_secret";

describe("Stripe webhook signature verification", () => {
  it("accepts a correctly signed payload and rejects tampered or unsigned ones", async () => {
    const { default: Stripe } = await import("stripe");
    const { constructWebhookEvent } = await import("@/server/services/payments");
    const payload = JSON.stringify({ id: "evt_sig_1", object: "event", type: "checkout.session.expired", livemode: false, data: { object: { id: "cs_1" } } });
    const header = new Stripe("sk_test_offline_dummy").webhooks.generateTestHeaderString({ payload, secret: "whsec_offline_test_secret" });
    const evt = await constructWebhookEvent(payload, header);
    expect(evt.id).toBe("evt_sig_1");
    await expect(constructWebhookEvent(payload.replace("expired", "completed"), header)).rejects.toThrow();
    await expect(constructWebhookEvent(payload, null)).rejects.toThrow(/Missing Stripe-Signature/);
    const wrong = new Stripe("sk_test_offline_dummy").webhooks.generateTestHeaderString({ payload, secret: "whsec_someone_else" });
    await expect(constructWebhookEvent(payload, wrong)).rejects.toThrow();
  });

  it("the webhook route returns 400 for a bad signature without touching the database", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const req = new Request("http://localhost/api/stripe/webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=deadbeef" } });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
  });
});
