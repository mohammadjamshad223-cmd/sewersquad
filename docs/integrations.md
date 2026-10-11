# Integrations & go-live blockers

Every external integration is optional at runtime. When credentials are missing, the feature shows an
explicit **"not configured"** state; it never pretends to work. Current state is visible in
**Admin → Settings → Integrations**.

| Integration | Env vars | State in this repository | When unconfigured |
|---|---|---|---|
| Stripe (card, ACH) | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_ENABLE_ACH`, `STRIPE_LIVE_APPROVED` | **Not configured.** Code paths covered by integration tests that use signed, synthetic webhook payloads. **Not run against Stripe's test API.** | Pay buttons hidden, customers see "pay by check or phone". Staff can still record manual payments. |
| Email (Resend) | `RESEND_API_KEY`, `EMAIL_FROM` | **Not configured. Not exercised against Resend.** | Notifications stay in-app. Delivery records are marked `SKIPPED` with a reason. When staff invite someone, the one-time invitation link is shown to them (with a copy button) to hand over. Self-service "Forgot password" requires email. Without it, staff can use **Send reset link** or **Resend invite** on any user, which shows the one-time link with a copy button. |
| SMS (Twilio) | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | **Not configured.** | SMS preferences remain, and sends are recorded as `SKIPPED`. |
| Object storage (S3 / R2 / MinIO) | `STORAGE_DRIVER=s3`, `S3_*` | **Not exercised against a real bucket.** Local driver tested. | Development uses `./storage`. Production refuses to start file operations on local storage unless `ALLOW_LOCAL_STORAGE=true`. |
| Maps | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | **No basemap/geocoding implemented.** | Dispatch "map" is a schematic plot from stored lat/lng. Navigation links open Google/Apple Maps (no key needed). Locations need lat/lng entered for the plot. |
| Brand assets | `public/brand/*`, `src/config/brand.ts` | **Done.** Official logo, navy `#002957` and green `#65AA27`. | — |

## Stripe — test mode first (required before any live use)

Live keys are **ignored** unless `STRIPE_LIVE_APPROVED=true`. Complete this checklist in test mode first.

1. In the Stripe dashboard (test mode) create a restricted or secret key (`sk_test_…`) and set `STRIPE_SECRET_KEY`.
2. Add a webhook endpoint `https://<APP_URL>/api/stripe/webhook` with these events:
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`,
   `payment_intent.payment_failed`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`.
   Set its signing secret as `STRIPE_WEBHOOK_SECRET`.
   For local testing: `stripe listen --forward-to localhost:3000/api/stripe/webhook`.
3. Verify each case, and check the invoice, payment and audit log after each one:
   - [ ] Card payment `4242 4242 4242 4242`: invoice becomes **Paid** only after the webhook arrives. The return page shows "processing" until then.
   - [ ] Paying two invoices in one checkout allocates the amount to each invoice.
   - [ ] Partial payment, where allowed, leaves the correct balance.
   - [ ] Declined card `4000 0000 0000 0002`: no payment recorded, invoice unchanged.
   - [ ] Expired or abandoned checkout releases the "processing" hold.
   - [ ] ACH (`STRIPE_ENABLE_ACH=true`): stays **Processing** until `async_payment_succeeded`, and `async_payment_failed` reverses it.
   - [ ] Refund from **Admin → Payments**: Stripe refund created and shown as pending. Balance is restored once `charge.refunded` arrives.
   - [ ] Refund issued directly in the Stripe dashboard: recorded as "Issued in the Stripe dashboard" and the invoice is re-opened.
   - [ ] Dispute (`4000 0000 0000 0259`): payment flagged and staff notified.
   - [ ] Replaying an event with `stripe events resend <id>` has no second effect.
   - [ ] A request with a bad signature is rejected with 400.
4. Only then switch to live keys, create the live webhook endpoint with the same events, and set `STRIPE_LIVE_APPROVED=true`.

Card data never touches this application. Stripe Checkout is hosted by Stripe, and we store only
Stripe IDs, amounts, brand and last-4 as returned by Stripe.

## Email (Resend)

1. Verify your sending domain in Resend (SPF/DKIM).
2. Set `RESEND_API_KEY` and `EMAIL_FROM` (e.g. `Sewer Squad <office@yourdomain.com>`).
3. Send yourself a staff invitation and a password reset. Confirm the links point at `APP_URL`.
4. Deliveries retry via the `deliveries` cron task. Failed or skipped deliveries are listed per notification.

## SMS (Twilio)

Set the three Twilio variables. SMS goes only to users who opted in under notification preferences.
US A2P 10DLC registration is your responsibility before sending at volume.

## Object storage

Use a **private** bucket: no public ACLs, block public access on. The app serves files only through
`/api/documents/:id`, which re-checks authorization and then redirects to a 60-second presigned URL.
- AWS: set `S3_BUCKET` and `S3_REGION`, plus an IAM user limited to `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that bucket.
- Cloudflare R2: set `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and `S3_REGION=auto`.
- MinIO: also set `S3_FORCE_PATH_STYLE=true`.
Enable bucket versioning (see [backups](backups.md)).

## Compliance data that must come from you

The platform deliberately leaves these blank rather than inventing them:
- Hauler transporter permit and registration numbers (**Settings → Company**). They print on manifests.
- Disposal facility permit numbers and accepted waste types (**Admin → Disposal → Facilities**).
- Manifest template required fields per jurisdiction (City of Houston, Harris County, etc.). The
  default template is a starting point only. Confirm it with the local authority.
- Sales-tax treatment of services (default 0%). Confirm it with your tax advisor.
- Pricing: no prices are hard-coded. Configure them in **Settings → Pricing rules** and per service plan.
