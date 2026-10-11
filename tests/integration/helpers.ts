import { PrismaClient, Prisma } from "@prisma/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSIONS, ALL_PERMISSIONS, SYSTEM_ROLES, type SystemRoleKey } from "@/server/authz/permissions";
import { DEFAULT_TEMPLATE_FIELDS } from "@/domain/manifest";
import { loadActorBySessionId, type Actor } from "@/server/auth/session";
import { randomUUID } from "node:crypto";
import { addDays, dateFromKey, todayKey } from "@/lib/dates";

export const prisma = new PrismaClient();

// A tiny valid PNG (1x1) padded so it passes "non-empty image" checks.
export const PNG = new Uint8Array(Buffer.from("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000D49444154789C6360000002000154A24F5D0000000049454E44AE426082", "hex"));
export const SIGNATURE = `data:image/png;base64,${Buffer.concat([Buffer.from(PNG), Buffer.alloc(400)]).toString("base64")}`;

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
const uniq = () => `${Date.now().toString(36)}${(n++).toString(36)}`;

export async function seedRbac() {
  const ids = new Map<string, string>();
  for (const key of ALL_PERMISSIONS) ids.set(key, (await prisma.permission.create({ data: { key, description: PERMISSIONS[key].description, group: PERMISSIONS[key].group } })).id);
  for (const [key, meta] of Object.entries(SYSTEM_ROLES) as [SystemRoleKey, { name: string }][]) {
    await prisma.role.create({ data: { key, name: meta.name, permissions: { create: DEFAULT_ROLE_PERMISSIONS[key].map((p) => ({ permissionId: ids.get(p)! })) } } });
  }
  await prisma.manifestTemplate.create({ data: { key: "default", name: "Default", jurisdiction: "TX", fields: DEFAULT_TEMPLATE_FIELDS as unknown as Prisma.InputJsonValue, isDefault: true } });
  await prisma.companySetting.create({ data: { key: "hauler", value: { legalName: "Test Hauler" } } });
  await prisma.pricingRule.create({ data: { name: "Interceptor per gallon", kind: "PER_GALLON", serviceType: "INTERCEPTOR_PUMPING", amountCents: new Prisma.Decimal("30") } });
}

/** Create a user with a session and return the Actor exactly as the app would load it. */
export async function actorFor(userId: string): Promise<Actor> {
  const id = `test-${randomUUID()}`;
  await prisma.session.create({ data: { id, userId, expiresAt: new Date(Date.now() + 3600_000), mfaVerified: true } });
  const a = await loadActorBySessionId(id);
  if (!a) throw new Error("actor not loaded");
  return a;
}

export async function staff(roleKey: SystemRoleKey) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: roleKey } });
  const u = await prisma.user.create({ data: { email: `${roleKey}-${uniq()}@t.test`, name: `${roleKey} user`, kind: "STAFF", status: "ACTIVE", roleId: role.id } });
  return actorFor(u.id);
}

export async function driver(vehicleCapacity = 3500) {
  const role = await prisma.role.findUniqueOrThrow({ where: { key: "driver" } });
  const u = await prisma.user.create({ data: { email: `driver-${uniq()}@t.test`, name: `Driver ${uniq()}`, kind: "DRIVER", status: "ACTIVE", roleId: role.id } });
  const v = await prisma.vehicle.create({ data: { unitNumber: `T-${uniq()}`, tankCapacityGallons: vehicleCapacity, status: "AVAILABLE" } });
  const d = await prisma.driver.create({ data: { userId: u.id, employeeNumber: `E-${uniq()}`, defaultVehicleId: v.id } });
  return { actor: await actorFor(u.id), driver: d, vehicle: v };
}

export async function org(name = `Org ${uniq()}`, opts: { locations?: number; billingMode?: "CONSOLIDATED" | "PER_LOCATION" } = {}) {
  const o = await prisma.organization.create({ data: { name, accountNumber: `SS-${uniq()}`, billingMode: opts.billingMode ?? "PER_LOCATION" } });
  await prisma.billingProfile.create({ data: { organizationId: o.id, name: `${name} billing`, isDefault: true, paymentTermsDays: 30 } });
  const locations = [];
  for (let i = 0; i < (opts.locations ?? 2); i++) {
    const l = await prisma.serviceLocation.create({ data: { organizationId: o.id, code: `L-${uniq()}`, name: `${name} #${i + 1}`, addressLine1: `${100 + i} Main`, city: "Houston", postalCode: "77002" } });
    const a = await prisma.serviceAsset.create({ data: { assetTag: `A-${uniq()}`, organizationId: o.id, locationId: l.id, type: "GREASE_INTERCEPTOR", capacityGallons: 1000, placement: "OUTDOOR" } });
    locations.push({ ...l, asset: a });
  }
  return { org: o, locations };
}

export async function customer(organizationId: string, role: "ORG_ADMIN" | "LOCATION_MANAGER" | "READ_ONLY", locationIds: string[] = []) {
  const u = await prisma.user.create({ data: { email: `cust-${uniq()}@t.test`, name: "Customer User", kind: "CUSTOMER", status: "ACTIVE" } });
  await prisma.organizationMembership.create({ data: { organizationId, userId: u.id, role, canPay: role !== "READ_ONLY" } });
  for (const l of locationIds) await prisma.locationMembership.create({ data: { locationId: l, userId: u.id } });
  return actorFor(u.id);
}

export function today() {
  return todayKey();
}

export async function job(locationId: string, opts: { driverId?: string; vehicleId?: string; status?: "SCHEDULED" | "ASSIGNED" | "ARRIVED"; date?: string; assetId?: string } = {}) {
  const loc = await prisma.serviceLocation.findUniqueOrThrow({ where: { id: locationId } });
  return prisma.job.create({
    data: {
      jobNumber: `J-${uniq()}`,
      organizationId: loc.organizationId,
      locationId,
      type: "ONE_TIME",
      serviceType: "INTERCEPTOR_PUMPING",
      status: opts.status ?? (opts.driverId ? "ASSIGNED" : "SCHEDULED"),
      scheduledDate: dateFromKey(opts.date ?? today()),
      driverId: opts.driverId ?? null,
      vehicleId: opts.vehicleId ?? null,
      ...(opts.assetId ? { assets: { create: { assetId: opts.assetId } } } : {}),
    },
  });
}

export async function sentInvoice(organizationId: string, serviceLocationId: string | null, totalCents: number, opts: { allowPartial?: boolean; status?: "SENT" | "DRAFT" } = {}) {
  return prisma.invoice.create({
    data: {
      invoiceNumber: `INV-${uniq()}`,
      organizationId,
      serviceLocationId,
      status: opts.status ?? "SENT",
      issueDate: dateFromKey(today()),
      dueDate: dateFromKey(addDays(today(), 30)),
      paymentTermsDays: 30,
      subtotalCents: totalCents,
      totalCents,
      balanceCents: totalCents,
      allowPartial: opts.allowPartial ?? true,
      lineItems: { create: { kind: "SERVICE", description: "Service", quantity: new Prisma.Decimal(1), unitPriceCents: new Prisma.Decimal(totalCents), amountCents: totalCents } },
    },
  });
}

export async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    const c = (e as { code?: string }).code;
    if (c === code) return;
    throw new Error(`Expected AppError ${code}, got ${c ?? (e as Error).message}`);
  }
  throw new Error(`Expected AppError ${code}, but the call succeeded`);
}
