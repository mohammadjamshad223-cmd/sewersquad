# Security

## Authentication

- **Passwords:** Argon2id (`@node-rs/argon2`). Minimum 10 characters, with a letter and a number.
  Login errors are generic, and unknown emails still burn a hash so timing reveals nothing.
- **Lockout and rate limits:** an account locks for 15 minutes after 5 failed logins.
  Database-backed rate limits:
  - Login: 30 per IP and 10 per email per 15 minutes.
  - Password reset: 3 per email and 10 per IP per hour.
  - Emergency requests: 10 per user per hour. Support tickets: 20 per user per hour.
- **Sessions:**
  - Random 256-bit token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production).
  - The database stores only its SHA-256 hash.
  - Sliding expiry (`SESSION_TTL_HOURS`).
  - Every session is revoked on password change, role change and deactivation.
- **MFA:** TOTP (RFC 6238) with hashed single-use recovery codes. The secret is encrypted at rest
  with AES-256-GCM under `APP_ENCRYPTION_KEY`. With `REQUIRE_ADMIN_MFA=true`, Super Admin, Admin
  and Accounting must enroll before they can open any page, action or API route, and cannot turn
  MFA off. Other users may opt in.
- **Tokens:** invitation (7 days), password reset (1 hour) and email verification (48 hours)
  tokens are single use. Only their hash is stored, and issuing a new token voids older ones.

## Authorization

- **Server-side only.** Every page calls a guard such as `requireStaffPage(permission)` or
  `requireCustomerPage()`. Every server action and API route calls `assertStaff`, `assertDriver`,
  `assertCustomer` or `assertSignedIn` before doing anything. Middleware only redirects for
  convenience and is never relied on.
- **Staff roles** (Super Admin, Admin, Dispatcher, Accounting, Driver) map to granular
  permissions. Super Admins can edit them in **Settings → Roles & permissions**.
  Services check permissions again internally, so a missing guard in a route still fails closed.
- **Customer scoping.** Every customer-owned row carries `organizationId` (and `locationId` where
  relevant). Customer queries always go through the predicates in `src/server/authz/scope.ts`.
  Location managers see only their assigned locations, and read-only users cannot pay or submit
  requests. Records are always looked up by ID *and* scope, so changing an ID in the URL returns 404.
- **Drivers** see only jobs assigned to them, and only for the operational window.
- **Integration tests** (`tests/integration/authorization.test.ts`) try cross-organization and
  cross-location access for every scoped resource type, and e2e tests do the same by URL.

## Documents & files

- The storage bucket is private. Files are served only through `/api/documents/:id`, which
  re-authorizes each request and then streams the file (local) or redirects to a **60-second**
  presigned URL (S3). Customers never see storage keys.
- Uploads are type-checked by magic bytes (not the extension or client MIME type). The allow-list
  is PDF, JPEG, PNG, WebP, HEIC, CSV/TXT, DOCX and XLSX, with a configurable size limit.
  Filenames are sanitized.
- Internal-only documents are never shown to customers.

## Payments

- Card and bank details never touch this application. Payment happens on Stripe Checkout,
  hosted by Stripe.
- Invoices change **only** from webhook events, after their signature is verified against the
  raw request body. The browser "success" page only shows "processing".
- Event IDs are recorded, so replays are no-ops. Settlement checks that the amount matches.
  Allocations carry an `applied` flag, and refunds reconcile against Stripe's cumulative
  refunded amount under a row lock.
- Live keys are ignored until `STRIPE_LIVE_APPROVED=true`.

## Data integrity

- Money is stored in integer cents (sub-cent unit rates use `Decimal`). Totals are computed with
  integer math and round half away from zero. Postgres CHECK constraints reject negative or
  inconsistent invoice and payment amounts.
- **Audit log** is append-only. A database trigger rejects `UPDATE` and `DELETE`. It records actor,
  action, entity, before/after values, reason and IP.
- **Manifest versions** are immutable. A trigger blocks changes apart from attaching the PDF
  once. Corrections create a new version and keep the old one.
- Signatures are drawn by the signer and stored privately as PNG, with name, title, time and IP.
  When nobody can sign (e.g. no one on site), the driver records the reason instead. Nothing is
  ever pre-filled or generated.

## HTTP hardening

- HSTS (2 years, preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` with
  `frame-ancestors 'none'`, a strict `Referrer-Policy`, and a `Permissions-Policy` limited to
  camera and geolocation from this origin.
- **Content Security Policy:**
  - `default-src 'self'`, with `object-src 'none'` and `base-uri 'self'`.
  - `form-action` is limited to this origin and Stripe Checkout.
  - **Limitation:** `script-src` allows `'unsafe-inline'`, because the Next.js App Router injects
    inline bootstrap scripts. Removing it needs per-request nonces, which force every page to
    render dynamically. Most pages here are dynamic already, so a nonce-based policy (through
    middleware) is a reasonable follow-up.
- Server actions are protected by Next.js's same-origin check, and `poweredByHeader` is off.
- CSV exports neutralize spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR).

## Secrets

All secrets live only in server environment variables, which are read through `src/server/env.ts`
(marked `server-only`). The only public variable is `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, which is
currently unused. Rotate `CRON_SECRET`, Stripe keys and S3 keys through your host.
Rotating `APP_ENCRYPTION_KEY` invalidates enrolled MFA.

## Offline data on driver devices

Drafts and queued photos are stored in IndexedDB and encrypted with AES-GCM under a
**non-extractable** WebCrypto key. This protects them from casual inspection of the browser
profile, but not from malware running inside the signed-in browser. Drafts are deleted only after
the server confirms the save. Drivers should use device passcodes, and MDM is recommended.

## Dependency audit (as of this commit)

`npm audit --omit=dev` reports two transitive issues. Neither is reachable from user input at runtime:

- `postcss` bundled inside `next` (build-time CSS processing of our own stylesheets). Fixed only in Next 16.
- `deepmerge-ts` inside the `prisma` CLI's config loader (build/migrate time only).

Re-check with each upgrade, and plan the move to Next 16 once it is stable for this stack.

## Known limitations

- No admin-initiated password reset. Self-service reset requires email to be configured.
- There is no WebAuthn/passkey support yet. TOTP is the only second factor.
- Rate limits are per database. They work across instances, but they are not a substitute for an
  edge WAF on high-traffic deployments.
