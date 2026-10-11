# Admin guide & onboarding

## First-time setup (Super Admin)

1. Open the invitation link from `npm run db:bootstrap`, set a password and enroll an
   authenticator app. Save the recovery codes somewhere offline.
2. Go to **Settings → Company**:
   - Legal name, phone, address, time zone (default America/Chicago) and emergency phone.
   - **Hauler transporter permit and registration numbers.** These print on every manifest, and the field stays blank until you enter them.
3. Go to **Settings → Billing**: payment terms, sales tax (default 0%), partial payments, auto-invoice and auto-send on approval, reminder schedule and invoice footer.
4. Go to **Settings → Pricing rules** and add company default prices (per gallon, flat rate, minimum charge, emergency and after-hours surcharges, additional equipment, disposal fees). Nothing is priced until you do this. Jobs without a price are invoiced as drafts for manual review.
5. Go to **Settings → Manifest templates** and review the default template's required fields with your local authority. Add one template per jurisdiction as needed.
6. Go to **Disposal → Facilities** and add each facility, its permit number, accepted waste types and per-gallon rate (used for cost and margin reporting).
7. Go to **Drivers & Fleet**:
   - Add trucks (unit number, VIN, plate, tank capacity, registration and insurance expiry, cost per hour).
   - Invite drivers (CDL details live on the driver profile).
8. Go to **Settings → Staff** and invite Admin, Dispatcher and Accounting staff. Privileged roles enroll MFA on first sign-in.
9. Check **Settings → Integrations** and fix anything marked "Not configured" (see [integrations](integrations.md)).

If email isn't configured, each invite shows a **one-time invitation link** with a copy button.
Send it to the person through a trusted channel. It expires after 7 days.

## Onboarding a customer

1. **Customers → New customer**: organization, account type and billing basics.
2. **Locations** tab: add each service location with address, access instructions, contacts, latitude and longitude (for the dispatch plot) and territory.
3. On each location, add **equipment**: grease traps, interceptors, septic tanks, grit traps and lift stations, with capacity and tag.
4. On each location, add **service plans**:
   - Service type, assets, recurrence (every 30/60/90 days, weekly, monthly, …).
   - Anchor: fixed calendar, or based on the completion date.
   - Preferred window and any price overrides.
   Jobs are generated automatically within the scheduling horizon.
5. **Billing** tab: billing profiles (consolidated corporate billing or per location).
6. **Portal users** tab: invite customer users.

   | Role | Access |
   |---|---|
   | Org admin | All locations |
   | Location manager | Only assigned locations |
   | Read-only | View only, no payments |

   "Can pay" controls access to online payments.

Tell the customer what they will see: upcoming services, service history with photos,
manifests (PDF/ZIP/CSV), invoices and online payment (when Stripe is enabled), emergency
requests, documents and support.

## Working as owner-operator

You can run the business and do the jobs yourself from the same login:

- **Field mode:** go to **Settings → Staff** and click **Enable field mode** on your own row.
  - You can then be assigned jobs on the Dispatch Board like any driver.
  - **My Route (field mode)** in the sidebar opens the phone-friendly driver screens: before and after photos, gallons, signatures, and offline saving.
  - The **Office** button takes you back.
- **Adding files after the fact:** open any job and use **Add photos & files**.
  - You can add before or after photos from your camera roll, a signed or scanned paper manifest, or any other document such as an inspection report.
  - Untick **Visible to the customer** for internal-only files.
  - Before and after photos on jobs that aren't approved yet are shared with the customer when you approve the job.

## Daily operations

| Who | Where | What |
|---|---|---|
| Dispatcher | **Dispatch Board** | View by driver, truck, week or map. Assign unassigned jobs, watch the truck capacity bar, reorder stops |
| Dispatcher | **Emergency Requests** | Triage, then convert to a job and assign (the customer sees status updates) |
| Driver | **Today / Route** | Accept, en route, arrived, service wizard (before and after photos, gallons per asset, condition, signatures), submit, then log disposal |
| Admin | **Jobs → Needs review** | Approve to finalize the manifest and create or send the invoice. Reject with a reason to send it back to the driver |
| Accounting | **Invoices / Payments** | Draft invoices needing prices, manual payments, refunds, overdue and reminder status |
| Admin | **Disposal → Reconciliation** | Compare gallons collected with gallons disposed per truck and day, and explain variances |

## Driver onboarding (hand this to drivers)

1. Open the invitation link on your phone and set a password.
2. Optional: it is a normal website, so a browser bookmark works. For one-tap access you can also add it to your home screen (Safari: Share → Add to Home Screen; Chrome: ⋮ → Add to Home screen).
3. Allow the camera when asked, and allow location if you want arrival times recorded.
4. Each morning, open **Inspect** and complete the pre-trip inspection for your truck.
5. On a job, tap **Accept**, then **Start — en route** (the customer is notified), then **I've arrived**, and follow the service steps.
   With no signal, keep working: "Offline — saved on this device" means your work is safe on the
   phone and will upload when you reconnect. Don't log out until it shows "All changes saved".
6. If you can't service a site (locked gate, no access), use **Unable to service** and describe what happened. Report truck or site problems under **Report Issue**.

## Customer user onboarding (hand this to customers)

1. Open the invitation link and set a password. You can enable two-step sign-in under **Account Settings**.
2. Corporate users can switch between **All locations** and a single site from the location picker.
3. **Manifests**: download single PDFs, or select several to get a ZIP file or a CSV export.
4. **Invoices & Payments**: pay one or several invoices by card (or bank, if enabled) on Stripe's
   secure page. An invoice shows as paid once Stripe confirms the payment.
5. **Request Service**: for emergencies (overflow, backup, odor), choose the urgency. A
   dispatcher will confirm, and for anything urgent please also call the emergency number shown.

## Access changes

- Changing a staff role or deactivating a user signs them out everywhere immediately.
- Super Admin accounts can only be changed by another Super Admin, and you can't deactivate yourself.
- Every change is recorded in **Settings → Audit log**. Entries cannot be edited or deleted.
