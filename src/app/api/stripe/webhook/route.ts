import { NextResponse, type NextRequest } from "next/server";
import { constructWebhookEvent, handleStripeEvent } from "@/server/services/payments";
import { integrations } from "@/server/env";
import { logger } from "@/server/logger";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook endpoint. The signature is verified against the raw body before anything is
 * trusted. Processing is idempotent per event id (duplicate deliveries are acknowledged).
 */
export async function POST(req: NextRequest) {
  if (!integrations.stripe()) return NextResponse.json({ error: "Stripe not configured" }, { status: 503 });
  const raw = await req.text();
  let event;
  try {
    event = await constructWebhookEvent(raw, req.headers.get("stripe-signature"));
  } catch (err) {
    logger.warn("stripe.webhook_signature_invalid", { err });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    const result = await handleStripeEvent(event);
    return NextResponse.json({ received: true, result });
  } catch (err) {
    logger.error("stripe.webhook_processing_failed", { err, eventId: event.id, type: event.type });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
