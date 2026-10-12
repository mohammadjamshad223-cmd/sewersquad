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
| Maps (Google) | `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Implemented: dispatch stop map, location pin, automatic address → coordinates. Tested with an invalid key only (loads, fails cleanly); **not yet verified with a real key.** | Dispatch "map" is a schematic plot from stored lat/lng. Navigation links open Google/Apple Maps (no key needed). |
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

Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER` (e.g. `+17135550100`).

- US carriers block texts from unregistered business numbers, so complete **A2P 10DLC** registration
  (brand and campaign) in Twilio first. Opt-in happens when each user turns on text alerts under
  their notification settings in the portal.
- Every text starts with "Sewer Squad:" and ends with "Reply STOP to opt out." Twilio handles STOP/HELP.
- Phone numbers are converted to international format automatically. 10-digit numbers are treated as US.
- Sign-in links (invitations, password resets) are never sent by text.

## Object storage

Use a **private** bucket: no public ACLs, block public access on. The app serves files only through
`/api/documents/:id`, which re-checks authorization and then redirects to a 60-second presigned URL.
- AWS: set `S3_BUCKET` and `S3_REGION`, plus an IAM user limited to `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on that bucket.
- Cloudflare R2: set `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com` and `S3_REGION=auto`.
- MinIO: also set `S3_FORCE_PATH_STYLE=true`.
Enable bucket versioning (see [backups](backups.md)).

## Maps (Google)

One browser key powers the dispatch map, location pins and the automatic address lookup.
1. In Google Cloud Console, create a project, link billing, and enable the **Maps JavaScript API** and **Geocoding API**.
2. Create an API key. Under **Application restrictions**, choose **Websites** and add `https://portal.sewersquadservices.com/*` (and `https://sewersquad.vercel.app/*`). Under **API restrictions**, allow only those two APIs.
3. Set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` in Vercel and **redeploy**. The key is built into the page, so a redeploy is required.
4. Locations without coordinates are placed from their address automatically the next time staff open the dispatch map, the locations list or the location. Changing an address clears the old position so it is looked up again.

## Compliance data that must come from you

The platform deliberately leaves these blank rather than inventing them:
- Hauler transporter permit and registration numbers (**Settings → Company**). They print on manifests.
- Disposal facility permit numbers and accepted waste types (**Admin → Disposal → Facilities**).
  - City of Houston #: printed on invoices, proposals, reports and manifests (as "COH FOG #") once entered in **Settings → Company**. Locations set to "City of Houston manifest fee" also prompt the driver to photograph the official City manifest.
- Manifest / ticket numbering: portal manifests use `MF-YYYY-NNNNNN` unless **Next manifest / ticket #** is set, in which case they continue your paper ticket numbers.
- Manifest template required fields per jurisdiction (City of Houston, Harris County, etc.). The
  default template is a starting point only. Confirm it with the local authority.
- Sales-tax treatment of services (default 0%). Confirm it with your tax advisor.
- Pricing: no prices are hard-coded. Configure them in **Settings → Pricing rules** and per service plan.
