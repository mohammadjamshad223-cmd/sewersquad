/**
 * DEMONSTRATION DATA ONLY.
 *
 * Every record created here is fictional and flagged `isDemo` where the model supports it; user
 * accounts use the reserved `.test` TLD. This script refuses to run when NODE_ENV=production so
 * demo data can never be mixed into a production customer account.
 *
 * Run with:  npm run db:seed   (password for all demo users: see DEMO_PASSWORD below)
 */
import { PrismaClient, Prisma, type ServiceType, type AssetType } from "@prisma/client";
import { hash } from "@node-rs/argon2";
import { ALL_PERMISSIONS, DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, SYSTEM_ROLES, type SystemRoleKey } from "../src/server/authz/permissions";
import { DEFAULT_TEMPLATE_FIELDS } from "../src/domain/manifest";
import { computeInvoiceTotals } from "../src/domain/invoice-math";
import { firstOccurrenceOnOrAfter, nextOccurrence, type Rule } from "../src/domain/recurrence";
import { addDays, dateFromKey, todayKey, type DateKey } from "../src/lib/dates";
import { parseDollarRateToCentsString } from "../src/lib/money";
import { lineAmountCents } from "../src/domain/invoice-math";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production.");
  process.exit(1);
}

const prisma = new PrismaClient();
export const DEMO_PASSWORD = "SewerSquad-demo-2026";
const TZ = "America/Chicago";
const today = todayKey(TZ);

let seq: Record<string, number> = {};
const next = (k: string, start = 1) => (seq[k] = (seq[k] ?? start - 1) + 1);
const year = new Date().getUTCFullYear();
const pad = (n: number, w: number) => String(n).padStart(w, "0");

// Deterministic pseudo-random so the demo looks the same on every reset.
let rnd = 42;
const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const between = (a: number, b: number) => Math.round(a + rand() * (b - a));

async function reset() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // TRUNCATE bypasses the append-only row triggers (they guard UPDATE/DELETE only).
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

async function main() {
  console.log("Resetting database…");
  await reset();
  seq = {};
  const passwordHash = await hash(DEMO_PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });

  // ── RBAC ──
  const perms = new Map<string, string>();
  for (const key of ALL_PERMISSIONS) {
    const p = await prisma.permission.create({ data: { key, description: PERMISSIONS[key].description, group: PERMISSIONS[key].group } });
    perms.set(key, p.id);
  }
  const roles = new Map<SystemRoleKey, string>();
  for (const [key, meta] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, { name: string; description: string }][]) {
    const r = await prisma.role.create({ data: { key, name: meta.name, description: meta.description, isSystem: true, permissions: { create: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ permissionId: perms.get(p)! })) } } });
    roles.set(key, r.id);
  }

  // ── Settings ──
  const settings: Record<string, unknown> = {
    company: { name: "Sewer Squad", phone: "(713) 555-0100", email: "office@demo.sewersquad.test", addressLine1: "1200 Demo Industrial Blvd", city: "Houston", state: "TX", postalCode: "77002", website: "", timeZone: TZ },
    emergency: { phone: "(713) 555-0199" },
    hauler: { legalName: "Sewer Squad (Demo)", transporterPermitNumber: "", registrationNumber: "" },
    billing: { defaultPaymentTermsDays: 30, defaultTaxRateBps: 0, allowPartialPayments: true, autoInvoiceOnApproval: true, autoSendInvoices: true },
  };
  for (const [key, value] of Object.entries(settings)) await prisma.companySetting.create({ data: { key, value: value as Prisma.InputJsonValue } });

  await prisma.manifestTemplate.create({
    data: {
      key: "tx-default-liquid-waste",
      name: "Texas — Non-hazardous liquid waste (default)",
      jurisdiction: "TX",
      wasteTypes: [],
      serviceTypes: [],
      fields: DEFAULT_TEMPLATE_FIELDS as unknown as Prisma.InputJsonValue,
      isDefault: true,
      notes: "Starting template. Confirm required fields with each local authority (e.g. City of Houston, Harris County) before relying on it for compliance.",
    },
  });

  // Company default pricing (demo values — configure real prices in Settings → Pricing).
  await prisma.pricingRule.createMany({
    data: [
      { name: "Grease trap pumping — per gallon", kind: "PER_GALLON", serviceType: "GREASE_TRAP_PUMPING", amountCents: new Prisma.Decimal("32") },
      { name: "Interceptor pumping — per gallon", kind: "PER_GALLON", serviceType: "INTERCEPTOR_PUMPING", amountCents: new Prisma.Decimal("28") },
      { name: "Minimum service charge", kind: "MINIMUM_CHARGE", amountCents: new Prisma.Decimal("17500") },
      { name: "Emergency surcharge", kind: "EMERGENCY_SURCHARGE", amountCents: new Prisma.Decimal("0"), percentBps: 5000 },
      { name: "Septic pumping — flat", kind: "FLAT_RATE", serviceType: "SEPTIC_PUMPING", amountCents: new Prisma.Decimal("45000") },
      { name: "Grit trap cleaning — flat", kind: "FLAT_RATE", serviceType: "GRIT_TRAP_CLEANING", amountCents: new Prisma.Decimal("38500") },
    ],
  });

  const facilities = await Promise.all([
    prisma.disposalFacility.create({ data: { name: "Demo Bayou Liquid Waste Facility", addressLine1: "8800 Demo Treatment Way", city: "Houston", state: "TX", postalCode: "77029", phone: "(713) 555-0144", permitNumber: "DEMO-FAC-001", acceptedWasteTypes: ["Grease trap waste", "Grit trap waste"], ratePerGallonCents: new Prisma.Decimal("6.5") } }),
    prisma.disposalFacility.create({ data: { name: "Demo Westside Processing", addressLine1: "4500 Demo Recycling Rd", city: "Katy", state: "TX", postalCode: "77493", phone: "(281) 555-0177", permitNumber: "DEMO-FAC-002", acceptedWasteTypes: ["Grease trap waste", "Septic waste"], ratePerGallonCents: new Prisma.Decimal("7") } }),
  ]);

  // ── Staff ──
  const staff = async (email: string, name: string, role: SystemRoleKey) =>
    prisma.user.create({ data: { email, name, kind: "STAFF", status: "ACTIVE", passwordHash, emailVerifiedAt: new Date(), roleId: roles.get(role)!, isDemo: true } });
  const owner = await staff("owner@demo.sewersquad.test", "Morgan Reyes", "super_admin");
  const admin = await staff("admin@demo.sewersquad.test", "Avery Collins", "admin");
  await staff("dispatch@demo.sewersquad.test", "Jordan Pierce", "dispatcher");
  await staff("accounting@demo.sewersquad.test", "Riley Chen", "accounting");

  // ── Fleet ──
  const trucks = await Promise.all([
    prisma.vehicle.create({ data: { unitNumber: "T-101", vin: "1FVACXDT0DEMO0101", licensePlate: "DEMO101", make: "Freightliner", model: "M2 106", year: 2021, tankCapacityGallons: 3500, status: "ASSIGNED", registrationExpiry: dateFromKey(addDays(today, 140)), insuranceExpiry: dateFromKey(addDays(today, 200)), permitNumber: "DEMO-PRM-101", costPerHourCents: 8500 } }),
    prisma.vehicle.create({ data: { unitNumber: "T-102", vin: "1FVACXDT0DEMO0102", licensePlate: "DEMO102", make: "International", model: "MV607", year: 2022, tankCapacityGallons: 3000, status: "ASSIGNED", registrationExpiry: dateFromKey(addDays(today, 25)), insuranceExpiry: dateFromKey(addDays(today, 200)), permitNumber: "DEMO-PRM-102", costPerHourCents: 8000 } }),
    prisma.vehicle.create({ data: { unitNumber: "T-103", vin: "1FVACXDT0DEMO0103", licensePlate: "DEMO103", make: "Peterbilt", model: "348", year: 2019, tankCapacityGallons: 4000, status: "MAINTENANCE", notes: "Demo: vacuum pump rebuild scheduled", costPerHourCents: 9000 } }),
  ]);
  await prisma.vehicleMaintenance.create({ data: { vehicleId: trucks[2]!.id, performedOn: dateFromKey(addDays(today, -3)), category: "Pump", description: "Vacuum pump inspection — rebuild recommended", costCents: 42000, vendor: "Demo Fleet Services" } });

  const driverUsers = [
    { email: "driver.luis@demo.sewersquad.test", name: "Luis Ortega", truck: trucks[0]!, territory: "Houston Central", rate: 3200 },
    { email: "driver.dana@demo.sewersquad.test", name: "Dana Brooks", truck: trucks[1]!, territory: "West / Katy", rate: 3000 },
    { email: "driver.sam@demo.sewersquad.test", name: "Sam Whitaker", truck: null, territory: "North / Woodlands", rate: 2900 },
  ];
  const drivers: Prisma.DriverGetPayload<{ include: { user: true } }>[] = [];
  for (const d of driverUsers) {
    const u = await prisma.user.create({ data: { email: d.email, name: d.name, phone: "(713) 555-01" + pad(next("phone", 10), 2), kind: "DRIVER", status: "ACTIVE", passwordHash, emailVerifiedAt: new Date(), roleId: roles.get("driver")!, isDemo: true } });
    drivers.push(await prisma.driver.create({ data: { userId: u.id, employeeNumber: `D-${pad(next("emp", 101), 4)}`, territory: d.territory, licenseClass: "B", licenseNumber: `DEMO${between(1000000, 9999999)}`, licenseExpiry: dateFromKey(addDays(today, between(100, 700))), hourlyCostCents: d.rate, defaultVehicleId: d.truck?.id ?? null, hireDate: dateFromKey(addDays(today, -between(200, 1500))) }, include: { user: true } }));
  }

  // ── Customers ──
  type LocSpec = { name: string; addr: string; city: string; zip: string; county: string; lat: number; lng: number; territory: string; assets: { type: AssetType; cap: number; place: "INDOOR" | "OUTDOOR"; where: string }[]; plan: { days?: number; months?: number; service: ServiceType; perGallon?: string; flat?: number; anchor?: "FIXED_CALENDAR" | "COMPLETION_DATE" } };
  type OrgSpec = { name: string; type: "RESTAURANT_GROUP" | "RESTAURANT" | "HOTEL" | "HOSPITAL" | "SCHOOL"; billing: "CONSOLIDATED" | "PER_LOCATION"; email: string; phone: string; locations: LocSpec[] };
  const orgs: OrgSpec[] = [
    {
      name: "ABC Restaurant Group (Demo)",
      type: "RESTAURANT_GROUP",
      billing: "PER_LOCATION",
      email: "ap@abc-group.demo.test",
      phone: "(713) 555-0210",
      locations: [
        { name: "ABC Restaurant — Downtown Houston", addr: "901 Demo Main St", city: "Houston", zip: "77002", county: "Harris", lat: 29.7589, lng: -95.3677, territory: "Houston Central", assets: [{ type: "GREASE_INTERCEPTOR", cap: 1500, place: "OUTDOOR", where: "Rear alley, under steel plate" }], plan: { days: 30, service: "INTERCEPTOR_PUMPING", perGallon: "0.30" } },
        { name: "ABC Restaurant — Katy", addr: "24100 Demo Katy Fwy", city: "Katy", zip: "77494", county: "Fort Bend", lat: 29.7858, lng: -95.8245, territory: "West / Katy", assets: [{ type: "GREASE_INTERCEPTOR", cap: 1000, place: "OUTDOOR", where: "Parking lot, NE corner" }, { type: "GREASE_TRAP", cap: 50, place: "INDOOR", where: "Under 3-compartment sink" }], plan: { days: 60, service: "INTERCEPTOR_PUMPING", perGallon: "0.30" } },
        { name: "ABC Restaurant — Sugar Land", addr: "16500 Demo Town Center Blvd", city: "Sugar Land", zip: "77479", county: "Fort Bend", lat: 29.5994, lng: -95.6202, territory: "West / Katy", assets: [{ type: "GREASE_INTERCEPTOR", cap: 1250, place: "OUTDOOR", where: "Dumpster enclosure" }], plan: { days: 60, service: "INTERCEPTOR_PUMPING", perGallon: "0.30" } },
        { name: "ABC Restaurant — The Woodlands", addr: "9595 Demo Six Pines Dr", city: "The Woodlands", zip: "77380", county: "Montgomery", lat: 30.1658, lng: -95.4613, territory: "North / Woodlands", assets: [{ type: "GREASE_INTERCEPTOR", cap: 2000, place: "OUTDOOR", where: "Service drive, two lids" }], plan: { days: 90, service: "INTERCEPTOR_PUMPING", perGallon: "0.28" } },
      ],
    },
    {
      name: "Bayou Taqueria (Demo)",
      type: "RESTAURANT",
      billing: "CONSOLIDATED",
      email: "owner@bayou-taqueria.demo.test",
      phone: "(832) 555-0330",
      locations: [{ name: "Bayou Taqueria", addr: "2210 Demo Navigation Blvd", city: "Houston", zip: "77003", county: "Harris", lat: 29.7531, lng: -95.3421, territory: "Houston Central", assets: [{ type: "GREASE_TRAP", cap: 100, place: "INDOOR", where: "Kitchen floor, near dish pit" }], plan: { months: 1, service: "GREASE_TRAP_PUMPING", flat: 22500 } }],
    },
    {
      name: "Gulf Coast Suites Hotel (Demo)",
      type: "HOTEL",
      billing: "CONSOLIDATED",
      email: "facilities@gcs-hotel.demo.test",
      phone: "(281) 555-0450",
      locations: [{ name: "Gulf Coast Suites — Galleria", addr: "5000 Demo Westheimer Rd", city: "Houston", zip: "77056", county: "Harris", lat: 29.7392, lng: -95.4614, territory: "Houston Central", assets: [{ type: "GREASE_INTERCEPTOR", cap: 3000, place: "OUTDOOR", where: "Loading dock" }, { type: "LINT_TRAP", cap: 300, place: "INDOOR", where: "Laundry room" }], plan: { months: 3, service: "INTERCEPTOR_PUMPING", perGallon: "0.27", anchor: "COMPLETION_DATE" } }],
    },
    {
      name: "Northside ISD Central Kitchen (Demo)",
      type: "SCHOOL",
      billing: "CONSOLIDATED",
      email: "nutrition@northside-isd.demo.test",
      phone: "(281) 555-0560",
      locations: [{ name: "Northside ISD — Central Kitchen", addr: "700 Demo School Rd", city: "Spring", zip: "77373", county: "Harris", lat: 30.0799, lng: -95.4172, territory: "North / Woodlands", assets: [{ type: "GREASE_INTERCEPTOR", cap: 2500, place: "OUTDOOR", where: "Behind cafeteria" }], plan: { days: 90, service: "INTERCEPTOR_PUMPING", perGallon: "0.28" } }],
    },
  ];

  const custUsers: { email: string; name: string; org: number; role: "ORG_ADMIN" | "LOCATION_MANAGER" | "READ_ONLY"; locs?: number[] }[] = [
    { email: "corporate@abc-group.demo.test", name: "Priya Shah", org: 0, role: "ORG_ADMIN" },
    { email: "katy.manager@abc-group.demo.test", name: "Marcus Lee", org: 0, role: "LOCATION_MANAGER", locs: [1] },
    { email: "viewer@abc-group.demo.test", name: "Elena Novak", org: 0, role: "READ_ONLY", locs: [0, 2] },
    { email: "owner@bayou-taqueria.demo.test", name: "Rosa Martinez", org: 1, role: "ORG_ADMIN" },
    { email: "facilities@gcs-hotel.demo.test", name: "Grant Holloway", org: 2, role: "ORG_ADMIN" },
    { email: "nutrition@northside-isd.demo.test", name: "Tamika Johnson", org: 3, role: "ORG_ADMIN" },
  ];

  const createdOrgs = [];
  for (const o of orgs) {
    const org = await prisma.organization.create({
      data: { accountNumber: `SS-${next("account", 10001)}`, name: o.name, type: o.type, billingMode: o.billing, primaryEmail: o.email, primaryPhone: o.phone, accountRepId: admin.id, isDemo: true, notes: "Demonstration account — fictional data." },
    });
    const bp = await prisma.billingProfile.create({ data: { organizationId: org.id, name: `${o.name} — Accounts Payable`, billingEmail: o.email, addressLine1: o.locations[0]!.addr, city: o.locations[0]!.city, state: "TX", postalCode: o.locations[0]!.zip, paymentTermsDays: o.type === "SCHOOL" ? 45 : 30, isDefault: true } });
    const locs = [];
    for (const l of o.locations) {
      const loc = await prisma.serviceLocation.create({
        data: {
          organizationId: org.id,
          code: `LOC-${next("location", 10001)}`,
          name: l.name,
          addressLine1: l.addr,
          city: l.city,
          state: "TX",
          postalCode: l.zip,
          county: l.county,
          latitude: l.lat,
          longitude: l.lng,
          territory: l.territory,
          siteContactName: "Kitchen Manager (Demo)",
          siteContactPhone: "(713) 555-0" + between(300, 999),
          accessInstructions: "Check in with the kitchen manager. Lids require a 3/4\" socket.",
          specialRequirements: o.type === "HOTEL" ? "Service only between 5–8 AM (guest parking)." : null,
          defaultWindowStart: o.type === "HOTEL" ? "05:00" : "07:00",
          defaultWindowEnd: o.type === "HOTEL" ? "08:00" : "11:00",
          billingProfileId: bp.id,
          isDemo: true,
        },
      });
      const assets = [];
      for (const a of l.assets) {
        assets.push(await prisma.serviceAsset.create({ data: { assetTag: `AS-${pad(next("asset"), 6)}`, organizationId: org.id, locationId: loc.id, type: a.type, capacityGallons: a.cap, placement: a.place, installLocation: a.where, requiredEquipment: a.cap >= 1000 ? "Vacuum truck, 4\" hose, lid lifter" : "Hand pump or 2\" hose", frequencyDays: l.plan.days ?? (l.plan.months ?? 1) * 30 } }));
      }
      locs.push({ loc, assets, spec: l });
    }
    createdOrgs.push({ org, bp, locs, spec: o });
  }
  for (const cu of custUsers) {
    const target = createdOrgs[cu.org]!;
    const u = await prisma.user.create({ data: { email: cu.email, name: cu.name, kind: "CUSTOMER", status: "ACTIVE", passwordHash, emailVerifiedAt: new Date(), isDemo: true } });
    await prisma.organizationMembership.create({ data: { organizationId: target.org.id, userId: u.id, role: cu.role, canPay: cu.role !== "READ_ONLY" } });
    for (const li of cu.locs ?? []) await prisma.locationMembership.create({ data: { locationId: target.locs[li]!.loc.id, userId: u.id } });
    await prisma.customerContact.create({ data: { organizationId: target.org.id, locationId: cu.locs?.length === 1 ? target.locs[cu.locs[0]!]!.loc.id : null, name: cu.name, email: cu.email, title: cu.role === "ORG_ADMIN" ? "Owner / Corporate" : "Manager", isPrimary: cu.role === "ORG_ADMIN", receivesInvoices: cu.role === "ORG_ADMIN" } });
  }

  // ── Plans + history ──
  const driverFor = (territory: string) => drivers.find((d) => d.territory === territory) ?? drivers[0]!;
  let invoiceCount = 0;
  for (const { org, bp, locs } of createdOrgs) {
    for (const { loc, assets, spec } of locs) {
      const p = spec.plan;
      const unit = p.days ? "DAY" : "MONTH";
      const interval = p.days ?? p.months!;
      const anchorDate = addDays(today, -(interval * (unit === "DAY" ? 1 : 30)) * 4 - between(0, 10));
      const rule: Rule = { unit, interval, anchor: p.anchor ?? "FIXED_CALENDAR", anchorDate };
      const rr = await prisma.recurrenceRule.create({ data: { unit, interval, anchor: rule.anchor, anchorDate: dateFromKey(anchorDate) } });
      const driver = driverFor(loc.territory!);
      const plan = await prisma.servicePlan.create({
        data: {
          planNumber: `SP-${pad(next("plan"), 5)}`,
          organizationId: org.id,
          locationId: loc.id,
          name: `${p.days ? `Every ${p.days} days` : p.months === 1 ? "Monthly" : "Quarterly"} ${p.service === "GREASE_TRAP_PUMPING" ? "grease trap" : "interceptor"} service`,
          serviceType: p.service,
          recurrenceRuleId: rr.id,
          preferredWindowStart: loc.defaultWindowStart,
          preferredWindowEnd: loc.defaultWindowEnd,
          pricingModel: p.flat ? "FLAT_RATE" : "PER_GALLON",
          flatPriceCents: p.flat ?? null,
          perGallonCents: p.perGallon ? new Prisma.Decimal(parseDollarRateToCentsString(p.perGallon)!) : null,
          minimumChargeCents: p.perGallon ? 17500 : null,
          territory: loc.territory,
          defaultDriverId: driver.id,
          defaultVehicleId: driver.defaultVehicleId,
          startDate: dateFromKey(anchorDate),
          assets: { create: assets.filter((a) => a.type !== "LINT_TRAP").map((a) => ({ assetId: a.id })) },
        },
      });

      // Historical occurrences up to today → completed jobs with records, manifests, invoices.
      let occ: DateKey | null = firstOccurrenceOnOrAfter(rule, anchorDate);
      let lastCompleted: DateKey | null = null;
      const planAssets = assets.filter((a) => a.type !== "LINT_TRAP");
      while (occ && occ < today) {
        const vehicleId = driver.defaultVehicleId ?? trucks[0]!.id;
        const finished = new Date(`${occ}T${loc.defaultWindowStart ?? "08:00"}:00-05:00`);
        finished.setMinutes(finished.getMinutes() + between(45, 110));
        const arrived = new Date(finished.getTime() - between(40, 90) * 60_000);
        const job = await prisma.job.create({
          data: {
            jobNumber: `J-${year}-${pad(next("job"), 6)}`,
            organizationId: org.id,
            locationId: loc.id,
            planId: plan.id,
            occurrenceDate: dateFromKey(occ),
            type: "RECURRING",
            serviceType: p.service,
            status: "COMPLETED",
            scheduledDate: dateFromKey(occ),
            windowStart: loc.defaultWindowStart,
            windowEnd: loc.defaultWindowEnd,
            confirmedByOffice: true,
            estimatedGallons: planAssets.reduce((s, a) => s + a.capacityGallons, 0),
            driverId: driver.id,
            vehicleId,
            completedAt: finished,
            approvedAt: new Date(finished.getTime() + 3 * 3600_000),
            approvedById: admin.id,
            isDemo: true,
            idempotencyKey: `plan:${plan.id}:${occ}`,
            assets: { create: planAssets.map((a) => ({ assetId: a.id })) },
            statusEvents: { create: [{ toStatus: "ASSIGNED", occurredAt: new Date(arrived.getTime() - 86_400_000) }, { fromStatus: "ASSIGNED", toStatus: "EN_ROUTE", occurredAt: new Date(arrived.getTime() - 1_800_000) }, { fromStatus: "EN_ROUTE", toStatus: "ARRIVED", occurredAt: arrived }, { fromStatus: "PENDING_DOCUMENTATION", toStatus: "SUBMITTED", occurredAt: finished }, { fromStatus: "SUBMITTED", toStatus: "COMPLETED", occurredAt: new Date(finished.getTime() + 3 * 3600_000) }] },
          },
        });
        const recs = planAssets.map((a) => ({ assetId: a.id, cap: a.capacityGallons, gallons: Math.round(a.capacityGallons * (0.7 + rand() * 0.28)) }));
        await prisma.serviceRecord.create({
          data: {
            jobId: job.id,
            driverId: driver.id,
            vehicleId,
            arrivedAt: arrived,
            startedAt: new Date(arrived.getTime() + 5 * 60_000),
            finishedAt: finished,
            wasteType: "Grease trap waste",
            conditionBefore: "Normal grease cap, no overflow",
            conditionAfter: "Pumped to bottom, baffles intact",
            reviewStatus: "APPROVED",
            reviewedById: admin.id,
            reviewedAt: job.approvedAt,
            submittedAt: finished,
            assetRecords: { create: recs.map((r) => ({ assetId: r.assetId, capacityGallons: r.cap, gallonsPumped: r.gallons, wasteType: "Grease trap waste", servicePerformed: "Full pump-out and scrape" })) },
          },
        });
        const total = recs.reduce((s, r) => s + r.gallons, 0);
        const manifestNumber = `MF-${year}-${pad(next("manifest"), 6)}`;
        const manifest = await prisma.manifest.create({
          data: { manifestNumber, jobId: job.id, organizationId: org.id, locationId: loc.id, status: "FINALIZED", serviceDate: dateFromKey(occ), wasteType: "Grease trap waste", totalGallons: total, driverName: driver.user.name, currentVersion: 1, approvedAt: job.approvedAt, approvedById: admin.id, finalizedAt: job.approvedAt, finalizedById: admin.id, isDemo: true },
        });
        await prisma.manifestSignature.createMany({
          data: [
            { manifestId: manifest.id, role: "CUSTOMER", signerName: "Kitchen Manager (Demo)", signerTitle: "Manager", signedAt: finished },
            { manifestId: manifest.id, role: "DRIVER", signerName: driver.user.name, signerTitle: "Driver", signerUserId: driver.userId, signedAt: finished },
          ],
        });
        const data = {
          template: { key: "tx-default-liquid-waste", name: "Texas — Non-hazardous liquid waste (default)", jurisdiction: "TX" },
          reference: { manifestNumber, jobNumber: job.jobNumber, serviceDate: occ },
          generator: { businessName: loc.name, organizationName: org.name, accountNumber: org.accountNumber, address: `${loc.addressLine1}, ${loc.city}, TX ${loc.postalCode}`, locationName: loc.name, county: loc.county, contactName: loc.siteContactName, contactPhone: loc.siteContactPhone },
          collection: { wasteType: "Grease trap waste", equipment: recs.map((r) => ({ assetTag: assets.find((a) => a.id === r.assetId)!.assetTag, type: "Grease Interceptor", capacityGallons: r.cap, gallonsPumped: r.gallons, servicePerformed: "Full pump-out and scrape" })), totalGallons: total, startedAt: arrived.toISOString(), finishedAt: finished.toISOString(), notes: null },
          hauler: { name: "Sewer Squad (Demo)", transporterPermitNumber: null, registrationNumber: null, driverName: driver.user.name, truckUnit: trucks.find((t) => t.id === vehicleId)!.unitNumber, vin: trucks.find((t) => t.id === vehicleId)!.vin, licensePlate: null, vehiclePermit: null, certificationStatement: null },
          disposal: { facilityName: facilities[0]!.name, facilityAddress: "8800 Demo Treatment Way, Houston, TX 77029", facilityPermit: "DEMO-FAC-001", disposedAt: new Date(finished.getTime() + 2 * 3600_000).toISOString(), ticketNumber: `DEMO-T${between(10000, 99999)}`, facilityAcknowledged: true },
          signatures: { customer: { name: "Kitchen Manager (Demo)", title: "Manager", signedAt: finished.toISOString(), unavailable: false, unavailableReason: null, hasImage: false }, driver: { name: driver.user.name, signedAt: finished.toISOString(), hasImage: false } },
          verification: { verifiedBy: admin.name, verifiedAt: job.approvedAt!.toISOString() },
          extra: { "Demo record": "Seeded demonstration data" },
        };
        await prisma.manifestVersion.create({ data: { manifestId: manifest.id, version: 1, data, contentHash: "demo-" + manifest.id.slice(0, 8), isFinal: true, reason: "Seeded demo record (no PDF generated)" } });

        // Disposal event for this load
        await prisma.disposalEvent.create({
          data: {
            eventNumber: `DE-${year}-${pad(next("disposal"), 5)}`,
            driverId: driver.id,
            vehicleId,
            facilityId: facilities[0]!.id,
            disposedAt: new Date(finished.getTime() + 2 * 3600_000),
            wasteType: "Grease trap waste",
            gallons: total + (rand() < 0.1 ? -between(40, 120) : 0), // a few unexplained discrepancies for the reconciliation demo
            ratePerGallonCents: new Prisma.Decimal("6.5"),
            totalCostCents: lineAmountCents(String(total), "6.5"),
            ticketNumber: data.disposal.ticketNumber,
            facilityAcknowledged: true,
            openingLoadGallons: 0,
            closingLoadGallons: 0,
            allocations: { create: { jobId: job.id, gallons: total } },
          },
        });

        // Invoice
        const lines = p.flat
          ? [{ kind: "FLAT_RATE", description: `Grease trap pumping — ${loc.name} (${occ})`, quantity: "1", unitPriceCents: String(p.flat), taxable: true }]
          : [{ kind: "PER_GALLON", description: `Interceptor pumping — ${total.toLocaleString()} gal (${occ})`, quantity: String(total), unitPriceCents: parseDollarRateToCentsString(p.perGallon!)!, taxable: true }];
        const t = computeInvoiceTotals(lines, 0);
        const issue = addDays(occ, 1);
        const due = addDays(issue, bp.paymentTermsDays);
        invoiceCount++;
        const ageDays = Math.round((Date.parse(today) - Date.parse(occ)) / 86_400_000);
        // Older invoices are paid; recent ones are open; a couple are overdue / partially paid.
        const paidState = ageDays > 75 ? "PAID" : ageDays > 45 ? (invoiceCount % 3 === 0 ? "OVERDUE" : "PAID") : invoiceCount % 4 === 0 ? "PARTIAL" : "OPEN";
        const paidCents = paidState === "PAID" ? t.totalCents : paidState === "PARTIAL" ? Math.round(t.totalCents / 2) : 0;
        const status = paidState === "PAID" ? "PAID" : due < today ? "OVERDUE" : paidState === "PARTIAL" ? "PARTIALLY_PAID" : "SENT";
        const inv = await prisma.invoice.create({
          data: {
            invoiceNumber: `INV-${year}-${pad(next("invoice"), 6)}`,
            organizationId: org.id,
            billingProfileId: bp.id,
            billingLocationId: org.billingMode === "PER_LOCATION" ? loc.id : null,
            serviceLocationId: loc.id,
            jobId: job.id,
            manifestId: manifest.id,
            status,
            serviceDate: dateFromKey(occ),
            issueDate: dateFromKey(issue),
            dueDate: dateFromKey(due),
            paymentTermsDays: bp.paymentTermsDays,
            subtotalCents: t.subtotalCents,
            totalCents: t.totalCents,
            amountPaidCents: paidCents,
            balanceCents: t.totalCents - paidCents,
            sentAt: new Date(`${issue}T15:00:00Z`),
            paidAt: paidState === "PAID" ? new Date(`${addDays(issue, between(3, 25))}T16:00:00Z`) : null,
            isDemo: true,
            lineItems: { create: lines.map((l, i) => ({ kind: l.kind as never, description: l.description, quantity: new Prisma.Decimal(l.quantity), unitPriceCents: new Prisma.Decimal(l.unitPriceCents), amountCents: t.lines[i]!.amountCents, taxable: true, sortOrder: i })) },
          },
        });
        if (paidCents > 0) {
          await prisma.payment.create({
            data: {
              paymentNumber: `PAY-${year}-${pad(next("payment"), 6)}`,
              organizationId: org.id,
              method: invoiceCount % 5 === 0 ? "CHECK" : "CARD",
              status: "SUCCEEDED",
              amountCents: paidCents,
              reference: invoiceCount % 5 === 0 ? `Check #${between(1000, 9999)}` : "Demo card payment (not processed by Stripe)",
              receivedAt: inv.paidAt ?? new Date(`${addDays(issue, 10)}T16:00:00Z`),
              isDemo: true,
              allocations: { create: { invoiceId: inv.id, amountCents: paidCents, applied: true } },
            },
          });
        }
        lastCompleted = occ;
        occ = nextOccurrence(rule, occ, occ);
      }
      // Upcoming occurrence → open job.
      const upcoming = occ ?? addDays(today, 7);
      await prisma.servicePlan.update({ where: { id: plan.id }, data: { nextServiceDate: dateFromKey(upcoming), lastCompletedAt: lastCompleted ? new Date(`${lastCompleted}T18:00:00Z`) : null } });
      await prisma.job.create({
        data: {
          jobNumber: `J-${year}-${pad(next("job"), 6)}`,
          organizationId: org.id,
          locationId: loc.id,
          planId: plan.id,
          occurrenceDate: dateFromKey(upcoming),
          type: "RECURRING",
          serviceType: p.service,
          status: "ASSIGNED",
          scheduledDate: dateFromKey(upcoming),
          windowStart: loc.defaultWindowStart,
          windowEnd: loc.defaultWindowEnd,
          estimatedGallons: planAssets.reduce((s, a) => s + a.capacityGallons, 0),
          driverId: driver.id,
          vehicleId: driver.defaultVehicleId,
          isDemo: true,
          idempotencyKey: `plan:${plan.id}:${upcoming}`,
          assets: { create: planAssets.map((a) => ({ assetId: a.id })) },
          statusEvents: { create: { toStatus: "ASSIGNED", note: "Generated from recurring plan" } },
          assignments: { create: { driverId: driver.id, vehicleId: driver.defaultVehicleId } },
        },
      });
    }
  }

  // A few jobs for TODAY so the driver portal and dispatch board have live work.
  const abc = createdOrgs[0]!;
  const todayStops = [
    { loc: abc.locs[0]!, driver: drivers[0]!, order: 1, window: ["07:00", "09:00"] },
    { loc: createdOrgs[1]!.locs[0]!, driver: drivers[0]!, order: 2, window: ["09:00", "11:00"] },
    { loc: createdOrgs[2]!.locs[0]!, driver: drivers[0]!, order: 3, window: ["11:00", "13:00"] },
    { loc: abc.locs[1]!, driver: drivers[1]!, order: 1, window: ["08:00", "10:00"] },
  ];
  for (const s of todayStops) {
    const assets = s.loc.assets.filter((a) => a.type !== "LINT_TRAP");
    await prisma.job.create({
      data: {
        jobNumber: `J-${year}-${pad(next("job"), 6)}`,
        organizationId: s.loc.loc.organizationId,
        locationId: s.loc.loc.id,
        type: "ONE_TIME",
        serviceType: "INTERCEPTOR_PUMPING",
        status: "ASSIGNED",
        scheduledDate: dateFromKey(today),
        windowStart: s.window[0],
        windowEnd: s.window[1],
        confirmedByOffice: true,
        routeOrder: s.order,
        estimatedGallons: assets.reduce((sum, a) => sum + a.capacityGallons, 0),
        driverId: s.driver.id,
        vehicleId: s.driver.defaultVehicleId,
        instructions: "Demo: additional cleanout requested by the customer.",
        isDemo: true,
        assets: { create: assets.map((a) => ({ assetId: a.id })) },
        statusEvents: { create: { toStatus: "ASSIGNED", note: "Demo job" } },
        assignments: { create: { driverId: s.driver.id, vehicleId: s.driver.defaultVehicleId } },
      },
    });
  }
  // One unassigned job for dispatch.
  await prisma.job.create({
    data: { jobNumber: `J-${year}-${pad(next("job"), 6)}`, organizationId: createdOrgs[3]!.org.id, locationId: createdOrgs[3]!.locs[0]!.loc.id, type: "ONE_TIME", serviceType: "INTERCEPTOR_PUMPING", status: "SCHEDULED", scheduledDate: dateFromKey(addDays(today, 1)), windowStart: "07:00", windowEnd: "11:00", estimatedGallons: 2500, confirmedByOffice: true, isDemo: true, assets: { create: { assetId: createdOrgs[3]!.locs[0]!.assets[0]!.id } }, statusEvents: { create: { toStatus: "SCHEDULED", note: "Demo job" } } },
  });

  // Emergency request awaiting triage.
  const katyMgr = await prisma.user.findUniqueOrThrow({ where: { email: "katy.manager@abc-group.demo.test" } });
  await prisma.emergencyRequest.create({
    data: {
      requestNumber: `ER-${year}-${pad(next("emergency"), 5)}`,
      organizationId: abc.org.id,
      locationId: abc.locs[1]!.loc.id,
      submittedById: katyMgr.id,
      contactName: "Marcus Lee",
      contactPhone: "(281) 555-0612",
      preferredContact: "PHONE",
      serviceType: "INTERCEPTOR_PUMPING",
      category: "TRAP_OVERFLOWING",
      severity: "URGENT",
      description: "Demo: grease backing up through floor drain near the fryer line since lunch rush.",
      requestedTiming: "ASAP",
      isDemo: true,
      events: { create: { toStatus: "SUBMITTED", actorId: katyMgr.id, note: "Request submitted online" } },
    },
  });
  // Support inquiry
  await prisma.supportTicket.create({
    data: { ticketNumber: `T-${pad(next("ticket", 1001), 5)}`, organizationId: abc.org.id, locationId: abc.locs[0]!.loc.id, createdById: (await prisma.user.findUniqueOrThrow({ where: { email: "corporate@abc-group.demo.test" } })).id, category: "BILLING", subject: "Question about per-gallon rate (demo)", messages: { create: { authorId: (await prisma.user.findUniqueOrThrow({ where: { email: "corporate@abc-group.demo.test" } })).id, body: "Can you confirm the contracted rate for Downtown? (demo inquiry)" } } },
  });
  // Driver issue
  await prisma.issueReport.create({ data: { reportNumber: `IR-${pad(next("issue"), 5)}`, reportedById: drivers[1]!.userId, vehicleId: trucks[1]!.id, category: "VEHICLE", severity: "MEDIUM", description: "Demo: hose reel bearing noisy, needs grease." } });

  // Sequence counters continue after seeded numbers.
  const sequences: [string, number][] = [
    ["account", seq.account ?? 10000], ["location", seq.location ?? 10000], ["asset", seq.asset ?? 0], ["plan", seq.plan ?? 0],
    [`job-${year}`, seq.job ?? 0], [`manifest-${year}`, seq.manifest ?? 0], [`invoice-${year}`, seq.invoice ?? 0], [`payment-${year}`, seq.payment ?? 0],
    [`emergency-${year}`, seq.emergency ?? 0], ["ticket", seq.ticket ?? 1000], [`disposal-${year}`, seq.disposal ?? 0], ["issue", seq.issue ?? 0], ["employee", seq.emp ?? 100],
  ];
  for (const [key, value] of sequences) await prisma.numberSequence.create({ data: { key, value } });

  void owner;
  console.log(`Seeded demo data. Sign in with any demo account using password: ${DEMO_PASSWORD}`);
  console.log("  owner@demo.sewersquad.test (super admin) · admin@ · dispatch@ · accounting@");
  console.log("  driver.luis@demo.sewersquad.test · driver.dana@ · driver.sam@");
  console.log("  corporate@abc-group.demo.test (org admin) · katy.manager@abc-group.demo.test (location manager) · viewer@abc-group.demo.test (read-only)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
