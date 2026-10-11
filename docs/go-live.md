# Go-live guide (no programming needed)

This walks you from this GitHub repository to a live portal that you, your staff, your drivers
and your clients sign in to. Plan on an afternoon. Most of the time goes to waiting for email
domain verification.

You will create accounts with these services. Each has a free or low-cost starting tier.
Check current pricing on their sites.

| Service | What it does for the portal |
|---|---|
| **Vercel** (Pro plan for a business) | Runs the website |
| **Neon** | The database: customers, jobs, invoices and so on |
| **Cloudflare R2** | Private storage for photos, signatures and PDFs |
| **Resend** | Sends invitation, reminder and invoice emails |
| **Stripe** | Online card and bank payments (optional, but needed for "Pay now") |
| A domain you own | For example `portal.yourcompany.com` |

> Vercel's free Hobby plan is for personal, non-commercial use. It also only allows once-a-day
> scheduled jobs. Use **Pro** for the business.

---

## Step 1: Merge the code

On GitHub, open the pull request for this work and click **Merge**. The live site is built from
the `main` branch.

## Step 2: Create the database (Neon)

1. Sign up at neon.tech and create a project. Pick the region closest to you (for Texas, US East (Ohio) or US East (N. Virginia)).
2. On the project dashboard, click **Connect** and copy two connection strings:
   - the **pooled** one (its host contains `-pooler`). This becomes `DATABASE_URL`.
   - the **direct** one (turn "Connection pooling" off). This becomes `DIRECT_DATABASE_URL`.
3. Under **Backups / Restore**, keep point-in-time restore on, at 7 days or more.

## Step 3: Create file storage (Cloudflare R2)

1. In the Cloudflare dashboard go to **R2 → Create bucket** and name it, e.g. `sewersquad-files`. Leave public access **off**.
2. Go to **R2 → Manage API tokens → Create API token** with **Object Read & Write** on that bucket only.
3. Write down the **Access Key ID**, the **Secret Access Key** and your account's **S3 endpoint** (`https://<account-id>.r2.cloudflarestorage.com`).

## Step 4: Set up email (Resend)

1. Sign up at resend.com, go to **Domains → Add domain**, and enter your domain.
2. Add the DNS records Resend shows you at your domain registrar. Wait until Resend says **Verified**, which can take from minutes to hours.
3. Go to **API Keys → Create** and copy the key.

## Step 5: Make three secret codes

Use your password manager's generator to make three random passwords of **40 or more
characters**, letters and numbers only. Store them in the password manager.

- `APP_ENCRYPTION_KEY` protects two-factor secrets. **Never lose or change it.**
- `CRON_SECRET` protects the scheduled jobs.
- `SETUP_TOKEN` is the one-time code you type when creating your owner account.

## Step 6: Deploy on Vercel

1. Sign up at vercel.com with your GitHub account, click **Add New → Project**, and import the `sewersquad` repository.
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** string |
   | `DIRECT_DATABASE_URL` | Neon **direct** string |
   | `APP_URL` | `https://portal.yourcompany.com` (or the `…vercel.app` address for now) |
   | `APP_ENCRYPTION_KEY` | secret #1 |
   | `CRON_SECRET` | secret #2 |
   | `SETUP_TOKEN` | secret #3 |
   | `REQUIRE_ADMIN_MFA` | `true` |
   | `STORAGE_DRIVER` | `s3` |
   | `S3_BUCKET` | `sewersquad-files` |
   | `S3_REGION` | `auto` |
   | `S3_ENDPOINT` | your R2 endpoint |
   | `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | from R2 |
   | `RESEND_API_KEY` | from Resend |
   | `EMAIL_FROM` | `Sewer Squad <office@yourcompany.com>` (must use the verified domain) |

3. Click **Deploy**. The build sets up the database tables automatically, and takes a few minutes.
4. Under **Settings → Domains**, add `portal.yourcompany.com` and create the DNS record Vercel
   shows. If `APP_URL` was the vercel.app address, change it to your domain and **Redeploy**.

## Step 7: Create your owner account

1. Open your portal address. The sign-in page says **"No owner account yet"**. Click **Create the owner account**.
2. Enter the setup code (`SETUP_TOKEN`), your name, email and a strong password.
3. Scan the QR code with an authenticator app (Google Authenticator, 1Password, Authy), enter the 6-digit code, and **save the recovery codes** somewhere safe.

The setup page switches itself off once your account exists. You can then delete `SETUP_TOKEN` from Vercel.

## Step 8: Set up your company

In the portal, follow **[First-time setup](admin-guide.md#first-time-setup-super-admin)**:

- company details and **permit numbers**
- billing terms and tax
- **pricing rules** (nothing is priced until you add them)
- manifest template
- disposal facilities
- trucks
- drivers and office staff

Then open **Settings → Integrations** and check that Email and File storage both say
**Configured**.

## Step 9: Turn on online payments (Stripe, test mode first)

1. In Stripe, switch to **Test mode** and go to **Developers → API keys**. Copy the secret key (`sk_test_…`).
2. Go to **Developers → Webhooks → Add endpoint**, enter `https://portal.yourcompany.com/api/stripe/webhook`, and select the events listed in [integrations.md](integrations.md#stripe--test-mode-first-required-before-any-live-use). Copy the **signing secret**.
3. In Vercel, add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (plus `STRIPE_ENABLE_ACH=true` for bank payments), then **Redeploy**.
4. Invite yourself as a test customer and pay an invoice with card `4242 4242 4242 4242`. Work through the whole checklist in integrations.md.
5. When everything checks out, repeat steps 1–3 with **live** keys and a live webhook. Then add `STRIPE_LIVE_APPROVED=true` and redeploy. Live keys stay switched off until you add that.

## Step 10: Invite your clients

For each client, go to **Customers → New customer**. Add their locations, equipment and service
plans, then open the **Portal users** tab and use **Send invitation**. They get an email to set their password. You can
re-send it any time with **Resend invite**, and **Send reset link** helps anyone who's locked out.

Before inviting clients, do a dry run with a test customer and a test driver of your own. Schedule a
job, complete it on a phone, approve it, and check the manifest and invoice the customer sees.

---

## Good to know

- **Uploads on Vercel are limited to about 4 MB per file.** Driver photos are shrunk
  automatically. Keep scanned PDFs under 4 MB, or host on your own server to allow larger files.
- **Backups:** Neon keeps point-in-time history. Also follow [backups.md](backups.md) for a nightly copy and for R2 versioning.
- **Monitoring:** point an uptime monitor (UptimeRobot, Better Stack) at `https://portal.yourcompany.com/api/health`.
- **Never** run the demo seed (`npm run db:seed`) against the live database. It erases everything.
