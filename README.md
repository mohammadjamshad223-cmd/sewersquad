# Sewer Squad — Customer Portal & Operations Platform

One application with three portals that share one PostgreSQL database:

| Portal | Path | Who |
|---|---|---|
| Customer | `/customer` | Restaurant groups, single sites, hotels, schools: services, manifests, invoices, payments, emergency requests, support |
| Driver | `/driver` | Mobile-first route, job workflow, completion wizard with photos, gallons and signatures (offline drafts), inspections, disposal |
| Admin / Dispatch | `/admin` | Customers, recurring plans, dispatch board, job review, manifests, billing, fleet, disposal reconciliation, reports, settings, audit |

Stack: Next.js 15 (App Router, server actions) · React 19 · TypeScript (strict) · Prisma 6 + PostgreSQL 16 · Tailwind ·
Stripe Checkout + webhooks · Resend (email) · Twilio (SMS, optional) · S3-compatible private storage · pdf-lib.

> **Status:** feature-complete against the brief and covered by unit, integration and end-to-end
> tests. Stripe, Resend, Twilio and S3 credentials are **not configured** in this repository and
> have **not been exercised against the live providers**. Brand assets are **placeholders**. See
> [docs/integrations.md](docs/integrations.md) for what must happen before go-live.

## Quick start (local)

Requirements: Node ≥ 20.11, PostgreSQL ≥ 14.

```bash
npm install
cp .env.example .env              # set DATABASE_URL, APP_ENCRYPTION_KEY (openssl rand -base64 48)
# for local development you may set REQUIRE_ADMIN_MFA="false"
npm run db:deploy                 # apply migrations (includes DB triggers & CHECK constraints)
npm run db:seed                   # DEMO data — refuses to run with NODE_ENV=production
npm run dev                       # http://localhost:3000
```

### Demo accounts (seed only)

Password for every demo account: `SewerSquad-demo-2026`. All demo users are flagged `isDemo` and use the reserved `.test` TLD.

| Email | Role |
|---|---|
| owner@demo.sewersquad.test | Super Admin |
| admin@demo.sewersquad.test | Admin |
| dispatch@demo.sewersquad.test | Dispatcher |
| accounting@demo.sewersquad.test | Accounting |
| driver.luis@ / driver.dana@ / driver.sam@demo.sewersquad.test | Drivers |
| corporate@abc-group.demo.test | Customer org admin (4 locations) |
| katy.manager@abc-group.demo.test | Customer location manager |
| viewer@abc-group.demo.test | Customer read-only |

The seed creates four customer organizations, recurring plans, ~6 months of completed history with
real generated manifest/invoice/receipt PDFs, today's routes, an open emergency, a support ticket and a
truck issue. Disposal facilities and permit numbers in the seed are fictitious and labelled "Demo".

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build (runs `prisma generate`) / production server |
| `npm run typecheck` · `npm run lint` | TypeScript and ESLint |
| `npm run db:migrate` | Create a new migration in development |
| `npm run db:deploy` | Apply migrations (CI / production) |
| `npm run db:seed` | Reset the database and load demo data (never in production) |
| `npm run db:bootstrap -- you@company.com "Your Name"` | Production (terminal alternative to the `/setup` page): create roles/permissions/default template and print a one-time Super Admin invitation link |
| `npm test` | Unit + integration tests (Vitest) against `DATABASE_URL_TEST` |
| `npm run test:e2e` | Playwright end-to-end tests (reseeds the dev database) |

### Tests

- **Unit** (`tests/unit`): recurrence engine, invoice math (integer cents, rounding), job state machine,
  capacity, reconciliation, profitability, manifest required fields.
- **Integration** (`tests/integration`, real PostgreSQL): cross-customer isolation for every scoped
  resource, location-level restrictions, idempotent scheduling, field → manifest → invoice workflow,
  manifest version immutability, webhook idempotency and amount checks, refunds/disputes, emergencies,
  auth (lockout, tokens, MFA), Stripe signature verification.
- **E2E** (`tests/e2e`): login/routing per role, server-side 403s, driver completion on a mobile
  viewport, offline draft + photo sync, admin approval → finalized manifest → sent invoice → customer
  view, emergency request, dispatch assignment, document isolation by ID.

```bash
createdb sewersquad_test                         # once
DATABASE_URL_TEST=postgresql://…/sewersquad_test npm test
npm run build && npm run test:e2e                # or E2E_BASE_URL=http://localhost:3000 against a running server
```

## Project layout

```
prisma/            schema, migrations (with hand-written triggers/constraints), seed, bootstrap
src/app/           routes: (auth), customer, driver, admin, api (documents, stripe/webhook, cron, export, live, health)
src/server/        server-only code: auth, authz (permissions, scoping), services, pdf, storage, integrations
src/domain/        pure business logic (recurrence, invoice math, job states, capacity, …) — unit tested
src/components/    UI kit, shells, portal/driver/admin components, charts
src/lib/           shared client/server helpers (dates, money, offline store)
tests/             unit, integration, e2e
docs/              deployment, integrations, security, architecture, admin guide, backups
```

## Documentation

- **[Go-live guide](docs/go-live.md): start here to put the portal into use (no programming needed)**
- [Deployment](docs/deployment.md) — Vercel or self-hosted, database, storage, cron, webhooks
- [Integrations & go-live blockers](docs/integrations.md) — Stripe, Resend, Twilio, S3, maps, brand assets
- [Admin guide & onboarding](docs/admin-guide.md) — first-time setup, staff, customers, drivers
- [Security](docs/security.md) — auth, MFA, RBAC, data isolation, documents, payments, known limitations
- [Architecture & decisions](docs/architecture.md)
- [Backups & recovery](docs/backups.md)
