# Deployment

The app is a standard Next.js 15 server. Two supported shapes:

- **Vercel + managed PostgreSQL + S3-compatible storage** (recommended)
- **A single self-hosted Node server** (Docker/VM) with PostgreSQL. It can use local disk storage if that disk is persistent and backed up.

## 1. Provision

| Component | Recommendation |
|---|---|
| PostgreSQL ≥ 14 | Neon, Supabase, RDS, Cloud SQL. Enable point-in-time recovery. |
| Object storage | Private S3 / R2 bucket with versioning (see [integrations](integrations.md#object-storage)) |
| Email | Resend with a verified domain |
| Payments | Stripe, **test mode first** |
| Domain / TLS | HTTPS is required. Session cookies are `Secure` in production and HSTS is sent. |

Serverless hosts open many short-lived connections. Use your provider's **pooled** connection
string for `DATABASE_URL` (Neon `-pooler` host, Supabase port 6543 with `?pgbouncer=true`). Run
migrations with the **direct** (non-pooled) URL.

## 2. Configure environment

Copy every variable from [`.env.example`](../.env.example) into the host's environment settings. Minimum for production:

```
DATABASE_URL, APP_URL, APP_ENCRYPTION_KEY, CRON_SECRET, REQUIRE_ADMIN_MFA=true,
STORAGE_DRIVER=s3, S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
RESEND_API_KEY, EMAIL_FROM
```

`APP_ENCRYPTION_KEY` encrypts MFA secrets at rest. Store it in your secret manager. Losing it
forces every privileged user to re-enroll MFA.

## 3. Migrate and bootstrap

```bash
DATABASE_URL=<direct url> npm run db:deploy
DATABASE_URL=<direct url> APP_URL=https://portal.example.com npm run db:bootstrap -- owner@example.com "Owner Name"
```

**No terminal?** On Vercel the `vercel-build` script runs migrations automatically (using
`DIRECT_DATABASE_URL`, or `DATABASE_URL_UNPOOLED` from Vercel's Neon integration, when set). Set `SETUP_TOKEN` and open `/setup` to create the first Super
Admin in the browser. The page disables itself once that account exists. See [go-live.md](go-live.md).

`db:deploy` applies the schema, including the Postgres triggers that make audit logs and
manifest versions immutable. `db:bootstrap` is idempotent. It creates system roles, permissions
and the default manifest template, then prints a **one-time invitation link** for the first Super
Admin. That person sets a password and enrolls TOTP MFA on first sign-in.

**Never run `npm run db:seed` against production.** It wipes the database and loads demo data.
It refuses to run when `NODE_ENV=production`.

On Vercel, run `db:deploy` from CI before promoting a deployment, or add it to the build command:
`npm run db:deploy && npm run build`.

Preview deployments (pull-request branches) are skipped by `ignoreCommand` in `vercel.json`. It skips
only when Vercel reports `VERCEL_ENV=preview`; if that variable is unavailable to the ignore step, the
build runs, so production deploys are never skipped by mistake. The
environment variables are Production-only, so a preview would have no database or storage. Only
`main` builds and deploys. To use previews, give them their own database branch and variables,
then remove that line.

## 4. Scheduled tasks

`vercel.json` registers the cron jobs below. Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
Elsewhere, call each endpoint with that header from any scheduler (cron, GitHub Actions, Cloud Scheduler).

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/schedule-plans` | daily 09:15 | Generate recurring jobs inside the scheduling horizon (idempotent) |
| `/api/cron/service-reminders` | daily 14:00 | Customer service reminders (deduplicated) |
| `/api/cron/invoice-reminders` | daily 14:30 | Mark overdue invoices, send due-date reminders |
| `/api/cron/deliveries` | every 15 min | Retry pending email/SMS deliveries |
| `/api/cron/cleanup` | daily 08:00 | Expired sessions, tokens, rate-limit buckets |

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://portal.example.com/api/cron/schedule-plans
```

Vercel's Hobby plan allows only daily crons. On Hobby, change `deliveries` to daily or use an external scheduler.

## 5. Stripe webhook

Create the endpoint `https://<APP_URL>/api/stripe/webhook` with the events listed in
[integrations.md](integrations.md#stripe--test-mode-first-required-before-any-live-use) and set
`STRIPE_WEBHOOK_SECRET`. Invoices are marked paid **only** from verified webhook events.

## 6. Verify

- `GET /api/health` returns `{"ok":true,"db":"up"}` (use for uptime monitoring).
- **Admin → Settings → Integrations** shows each provider's state.
- Sign in as the Super Admin, enroll MFA, then invite a test customer and a test driver.
- Run through the Stripe test-mode checklist before enabling live keys.

## Self-hosted single server

```bash
npm ci && npm run build
NODE_ENV=production npm run db:deploy
NODE_ENV=production npm start            # listens on :3000; put nginx/Caddy in front for TLS
```

With local storage, set `STORAGE_DRIVER=local`, `LOCAL_STORAGE_DIR=/var/lib/sewersquad/storage`
and `ALLOW_LOCAL_STORAGE=true`. Back that directory up together with the database.
Don't run multiple app instances on local storage.

## Logs and errors

The server writes structured JSON lines to stdout/stderr. Uncaught request errors are logged by
`src/instrumentation.ts` as `request_error` with the route and error digest, which is also the
reference ID shown to users on the error page. Forward stdout to your log drain or error monitor
(Vercel Log Drains, Datadog, Better Stack, …).

## Upgrades

1. `npm ci`, `npm run typecheck`, `npm test`, `npm run build`.
2. Apply migrations with `npm run db:deploy` (they are additive; review the SQL first).
3. Re-run `npm run db:bootstrap` so any newly added permissions exist. Existing role grants are not changed.
