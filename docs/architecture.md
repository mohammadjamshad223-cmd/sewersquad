# Architecture

## Shape

One Next.js App Router application runs on one PostgreSQL database. The three portals are route
groups that share the same service layer:

```
Browser ── pages (RSC) ──┐
        ── server actions ┼─▶ src/server/services/*  ─▶ Prisma ─▶ PostgreSQL
        ── /api routes ───┘        │   ▲                             (triggers, CHECKs)
                                   │   └── src/domain/* (pure logic, unit tested)
                                   ├─▶ storage (S3 / local)   ├─▶ pdf-lib renderers
                                   └─▶ Stripe / Resend / Twilio (optional)
Stripe ── /api/stripe/webhook ─▶ payments.handleStripeEvent
Scheduler ── /api/cron/:task ─▶ plans / reminders / invoices / notifications
```

- **Pages** are React Server Components. They call a page guard, then services or Prisma reads
  that are already scoped to the actor.
- **Mutations** are server actions in `src/app/**/actions.ts` and `src/app/admin/_actions/*`.
  Each one validates input with Zod (`formAction`), asserts the actor, and calls a service. The
  service checks permissions again, writes inside a transaction, records an audit entry and queues
  notifications.
- **Domain modules** (`src/domain`) have no I/O: recurrence, job state machine, invoice math,
  capacity, disposal reconciliation, profitability and manifest required fields.
- **Notifications** are written in the same transaction as the change they describe (outbox
  pattern). Delivery happens afterwards (`after()` plus the `deliveries` cron, with retries).

## Key flows

**Recurring scheduling.**
- A `ServicePlan` has a `RecurrenceRule`: every N days, weeks or months, or a list of specific
  dates. Presets cover 30/60/90 days, weekly, monthly, quarterly and similar.
- There are two anchor modes:
  - **Fixed calendar** uses the plan's start date.
  - **Completion-based** calculates the next date from the last completed service.
- `materializePlan` creates jobs inside the scheduling horizon. It is idempotent: the unique key
  `(planId, occurrenceDate)` and a check for an open job stop duplicates.
- Dates are calendar dates (`@db.Date`) in the company time zone, defaulting to America/Chicago,
  so DST never shifts a service day.

**Field to manifest to invoice.**
1. The driver moves the job through `ASSIGNED → EN_ROUTE → ARRIVED → IN_PROGRESS`. The state
   machine in `job-state.ts` defines who may make each transition.
2. The completion wizard saves server drafts and encrypted local drafts. Photos queue offline.
   Submitting writes the `ServiceRecord`, its per-asset gallons and the signatures, and takes the
   job to `SUBMITTED`.
3. A manifest is built from the job, location, assets and truck data plus the jurisdiction
   template. Each submission writes an **immutable `ManifestVersion`** (JSON snapshot plus PDF).
4. The office approves the job or rejects it with a reason. Approving finalizes the manifest
   (new version, status `FINALIZED`). If enabled, approval also creates an invoice from pricing
   rules, at most one per job, and sends it only when every line is priced.
5. Corrections to a finalized manifest create a new version with a required reason. Older
   versions stay downloadable.

**Billing.**
- Invoice totals come from `invoice-math.ts`: integer cents, BigInt for rate × quantity, and
  rounding half away from zero per line.
- Payments allocate to invoices oldest due date first.
- Stripe Checkout sessions are created server-side, and only webhooks settle them (see
  [security](security.md#payments)).
- Manual payments (check, cash) settle immediately and are audited.

**Real-time.** Portals poll `/api/live` every 20s with backoff. It returns a hash of the latest
`updatedAt` values in the actor's scope, and the client calls `router.refresh()` when the hash
changes. This keeps the server stateless (no websockets) and still serverless-friendly.

## Decisions (ADR summary)

| # | Decision | Why | Trade-off |
|---|---|---|---|
| 1 | Single Next.js app for all portals | One deploy, shared types and services, server-side authorization next to the data | Portals scale together |
| 2 | Custom DB sessions (Lucia-style) instead of an auth SaaS | Full control over MFA policy, lockout, multi-tenant memberships and audit. No external dependency at sign-in | We own the security-sensitive code, so it is covered by integration tests |
| 3 | Authorization as data scoping (`scope.ts`) plus permission checks in services | Cross-tenant leaks become a missing `WHERE`, which one predicate per resource prevents | Every new query must use the predicates |
| 4 | Integer cents everywhere, `Decimal` only for sub-cent unit rates | No float drift, enforced by DB CHECKs | Formatting happens at the edges |
| 5 | Postgres triggers for audit-log and manifest-version immutability | Holds even against application bugs or ad-hoc SQL | Fixing a mistake means a new correcting record |
| 6 | Outbox notifications with cron-driven delivery | Messages are sent only for committed changes, with retries and no lost emails | Delivery is asynchronous (seconds to minutes) |
| 7 | Polling instead of websockets for live updates | Works on serverless hosts and needs no extra infrastructure | Up to ~20s latency |
| 8 | Encrypted IndexedDB plus queued uploads for offline drivers | Basements and lift stations often have no signal, so drafts must survive a lost connection | Not a full offline app: pages need connectivity to load |
| 9 | PDFs rendered server-side with pdf-lib and stored as documents | Same output for customers, staff and regulators, with no headless browser in production | Layout is hand-built |
| 10 | Pricing entirely in the database (`PricingRule`, plan overrides) | No hard-coded prices, editable by staff | Unpriced jobs need a manual price before invoicing |

## Directory map

| Path | Contents |
|---|---|
| `src/server/auth` | sessions, passwords, MFA, tokens, rate limits |
| `src/server/authz` | permission catalog, role defaults, guards, customer scope predicates |
| `src/server/services` | business operations (one module per domain area) |
| `src/server/pdf` | manifest, invoice and receipt renderers |
| `src/server/storage` | storage drivers and upload validation |
| `src/server/integrations` | Resend and Twilio clients (Stripe lives in `services/payments.ts`) |
| `src/domain` | pure logic |
| `src/components` | UI kit (`ui/`), shells, portal-specific components, charts |
| `prisma/migrations` | schema plus hand-written triggers and constraints |
