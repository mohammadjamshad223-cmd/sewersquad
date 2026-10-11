import "server-only";
import { env, integrations } from "../env";
import type { SendResult } from "./email";

/** Optional SMS via Twilio's REST API. Returns "skipped" when not configured. */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!integrations.sms()) return { status: "skipped", reason: "SMS provider not configured (TWILIO_*)." };
  const e = env();
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: e.TWILIO_FROM_NUMBER!, Body: body.slice(0, 600) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { status: "failed", error: `Twilio ${res.status}: ${(await res.text()).slice(0, 300)}` };
    const json = (await res.json()) as { sid?: string };
    return { status: "sent", providerId: json.sid ?? null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}
