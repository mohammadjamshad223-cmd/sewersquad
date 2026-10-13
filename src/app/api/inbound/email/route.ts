import { NextResponse, type NextRequest } from "next/server";
import { env, integrations } from "@/server/env";
import { ingestInboundEmail, logInboundError, verifyResendWebhook } from "@/server/services/leads";

export const dynamic = "force-dynamic";

/**
 * Resend "email.received" webhook: emails forwarded from the Gmail and sales@ inboxes become leads.
 * Signed with the webhook's whsec_ secret; anything unsigned is rejected.
 */
export async function POST(req: NextRequest) {
  if (!integrations.leadsInbound()) return NextResponse.json({ error: "Inbound email is not configured." }, { status: 503 });
  const body = await req.text();
  const ok = verifyResendWebhook(body, { id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature") }, env().RESEND_INBOUND_WEBHOOK_SECRET!);
  if (!ok) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let event: { type?: string; data?: { email_id?: string } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }
  if (event.type !== "email.received" || !event.data?.email_id) return NextResponse.json({ ok: true, ignored: true });
  try {
    const res = await ingestInboundEmail(event.data.email_id);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    logInboundError(err, event.data.email_id);
    return NextResponse.json({ error: "Could not process email" }, { status: 500 }); // Resend retries
  }
}
