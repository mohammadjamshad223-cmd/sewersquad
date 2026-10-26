import "server-only";
import { env, integrations } from "../env";
import type { SendResult } from "./email";
import { toE164 } from "@/lib/phone";

/** Optional SMS via Twilio's REST API. Returns "skipped" when not configured. */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  if (!integrations.sms()) return { status: "skipped", reason: "SMS provider not configured (TWILIO_*)." };
  const e = env();
  const number = toE164(to);
  if (!number) return { status: "failed", error: `Not a valid mobile number: "${to.slice(0, 40)}". Use a 10-digit US number or +country format.` };
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: number,
        ...(e.TWILIO_MESSAGING_SERVICE_SID ? { MessagingServiceSid: e.TWILIO_MESSAGING_SERVICE_SID } : { From: toE164(e.TWILIO_FROM_NUMBER) ?? e.TWILIO_FROM_NUMBER! }),
        Body: body.slice(0, 600),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const text = await res.text();
      // 21610: the recipient replied STOP. Retrying never succeeds, so report it distinctly.
      const code = Number((/"code"\s*:\s*(\d+)/.exec(text) ?? [])[1]);
      return { status: "failed", error: `Twilio ${res.status}${code ? ` (code ${code})` : ""}: ${text.slice(0, 300)}`, unsubscribed: code === 21610, permanent: code === 21610 || code === 21211 || code === 21614 };
    }
    const json = (await res.json()) as { sid?: string };
    return { status: "sent", providerId: json.sid ?? null };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message : String(err) };
  }
}

/** Plain-language fixes for the Twilio error codes a new setup runs into. */
const TWILIO_FIXES: Record<number, string> = {
  20003: "Twilio rejected the Account SID / Auth Token. Copy both again from the Twilio Console home page into Vercel (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN), then Redeploy.",
  20404: "Twilio couldn't find that Account SID or Messaging Service. Check TWILIO_MESSAGING_SERVICE_SID (starts with MG) in Vercel, then Redeploy.",
  21211: "That isn't a valid phone number. Use a 10-digit US mobile number.",
  21408: "Texting to this country isn't turned on in Twilio (Messaging → Settings → Geo permissions).",
  21606: "The 'from' number can't send texts. Use the Twilio number you bought, or set TWILIO_MESSAGING_SERVICE_SID instead.",
  21608: "Your Twilio account is still a trial, which can only text numbers you verified. Upgrade the account in Twilio (Admin → Billing).",
  21610: "This phone replied STOP. Reply START from it to allow texts again.",
  21612: "Twilio can't send from your number to this phone. Check that the number in Twilio has SMS turned on.",
  21614: "That number is a landline or can't receive texts.",
  21659: "The 'from' number isn't one of your Twilio numbers. Fix TWILIO_FROM_NUMBER, or use TWILIO_MESSAGING_SERVICE_SID.",
  21703: "The Messaging Service has no phone number in it. In Twilio → Messaging → Services → your service → Sender Pool, add your number.",
  21704: "The Messaging Service has no phone number in it. In Twilio → Messaging → Services → your service → Sender Pool, add your number.",
  30003: "The phone was off or out of service. Try another phone.",
  30005: "The carrier says this number doesn't exist.",
  30006: "That number is a landline or can't receive texts.",
  30007: "The carrier filtered the text as spam. Usually goes away once your A2P campaign is approved.",
  30032: "Your toll-free number isn't verified yet. Finish toll-free verification in Twilio, or use a local 10DLC number.",
  30034: "Blocked by the carrier because your number isn't registered yet (A2P 10DLC). Texts start working once Twilio approves your Brand and Campaign and the number is in that campaign's Messaging Service.",
  30044: "Your Twilio trial has ended. Upgrade the account in Twilio (Admin → Billing).",
};
const fix = (code: number | null | undefined) => (code && TWILIO_FIXES[code]) || null;

export type SmsCheckStep = { label: string; ok: boolean | null; detail?: string };

/**
 * Settings → "Send test text": sends a real text and follows it to the phone, checking the
 * Twilio settings, A2P registration and the carrier's delivery result on the way.
 */
export async function diagnoseSms(to: string, body: string): Promise<SmsCheckStep[]> {
  const steps: SmsCheckStep[] = [];
  const e = env();
  if (!integrations.sms()) {
    steps.push({ label: "Twilio settings in this deploy", ok: false, detail: "Missing. In Vercel → Settings → Environment Variables (Production) add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_MESSAGING_SERVICE_SID, then Redeploy." });
    return steps;
  }
  steps.push({ label: "Twilio settings in this deploy", ok: true, detail: e.TWILIO_MESSAGING_SERVICE_SID ? `Sending through Messaging Service …${e.TWILIO_MESSAGING_SERVICE_SID.slice(-4)}.` : `Sending from ${e.TWILIO_FROM_NUMBER}. A Messaging Service (TWILIO_MESSAGING_SERVICE_SID) is recommended for A2P.` });
  const auth = `Basic ${Buffer.from(`${e.TWILIO_ACCOUNT_SID}:${e.TWILIO_AUTH_TOKEN}`).toString("base64")}`;
  const get = (url: string) => fetch(url, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });

  if (e.TWILIO_MESSAGING_SERVICE_SID) {
    try {
      const res = await get(`https://messaging.twilio.com/v1/Services/${e.TWILIO_MESSAGING_SERVICE_SID}/Compliance/Usa2p`);
      if (res.status === 401) {
        steps.push({ label: "Twilio sign-in", ok: false, detail: TWILIO_FIXES[20003] });
        return steps;
      }
      if (res.status === 404) steps.push({ label: "A2P registration (carrier approval)", ok: false, detail: TWILIO_FIXES[20404] });
      else if (res.ok) {
        const { compliance = [] } = (await res.json()) as { compliance?: { campaign_status?: string }[] };
        const status = compliance[0]?.campaign_status?.toUpperCase();
        steps.push(
          !status
            ? { label: "A2P registration (carrier approval)", ok: false, detail: "No A2P campaign is attached to this Messaging Service yet. In Twilio → Messaging → Regulatory Compliance, finish the Brand and Campaign and pick this Messaging Service for the campaign." }
            : status === "VERIFIED"
              ? { label: "A2P registration (carrier approval)", ok: true, detail: "Campaign approved." }
              : status === "FAILED"
                ? { label: "A2P registration (carrier approval)", ok: false, detail: "The campaign was rejected. Open it in Twilio → Messaging → Regulatory Compliance to see why, fix it and resubmit." }
                : { label: "A2P registration (carrier approval)", ok: false, detail: `Campaign is ${status.toLowerCase().replace(/_/g, " ")}: still waiting on carrier approval (usually a few days, up to 2 weeks). Texts to most phones are blocked until then.` },
        );
      }
    } catch {
      // The registration lookup is a hint; the real send below is the actual test.
    }
  }

  const sent = await sendSms(to, body);
  if (sent.status !== "sent") {
    const code = Number((/code (\d+)/.exec(sent.status === "failed" ? sent.error : "") ?? [])[1]);
    steps.push({ label: "Twilio accepts the text", ok: false, detail: fix(code) ?? (sent.status === "failed" ? sent.error : sent.reason) });
    return steps;
  }
  steps.push({ label: "Twilio accepts the text", ok: true });

  // Follow the message until the carrier reports back (usually a few seconds).
  let last: { status?: string; error_code?: number | null } = {};
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await get(`https://api.twilio.com/2010-04-01/Accounts/${e.TWILIO_ACCOUNT_SID}/Messages/${sent.providerId}.json`);
      if (res.ok) last = (await res.json()) as typeof last;
    } catch {
      // Keep polling.
    }
    if (last.status === "delivered" || last.status === "undelivered" || last.status === "failed") break;
  }
  if (last.status === "delivered") steps.push({ label: "Delivered to the phone", ok: true, detail: "The carrier confirmed delivery. Texting works." });
  else if (last.status === "undelivered" || last.status === "failed") steps.push({ label: "Delivered to the phone", ok: false, detail: fix(last.error_code) ?? `The carrier didn't deliver it${last.error_code ? ` (Twilio error ${last.error_code})` : ""}.` });
  else steps.push({ label: "Delivered to the phone", ok: null, detail: "Sent, but the carrier hasn't confirmed yet. Check the phone; if nothing arrives in a minute, try the test again." });
  return steps;
}
