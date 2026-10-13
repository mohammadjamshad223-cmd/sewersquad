import Link from "next/link";
import { Plus } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/misc";
import { addDays, compareKeys, dateFromKey, diffDays, formatDateKey, formatWindow, instantToDateKey, keyFromDate, todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { integrations } from "@/server/env";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { TRUCK_CAPACITY_DEFAULT } from "@/server/services/job-completion";
import { DispatchToday, type BoardStop } from "./today";

export const metadata = { title: "Dispatch board" };

const OPEN = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "SUBMITTED", "MISSED", "UNABLE_TO_SERVICE"] as const;

const include = {
  location: { select: { id: true, name: true, addressLine1: true, city: true, state: true, postalCode: true, latitude: true, longitude: true, siteContactName: true, siteContactPhone: true, accessInstructions: true, manifestFee: true, contacts: { where: { phone: { not: null } }, select: { name: true, phone: true, isPrimary: true }, orderBy: { isPrimary: "desc" as const }, take: 2 } } },
  organization: { select: { id: true, name: true, primaryPhone: true, contacts: { where: { phone: { not: null }, locationId: null }, select: { name: true, phone: true, isPrimary: true }, orderBy: { isPrimary: "desc" as const }, take: 2 } } },
  assets: { include: { asset: { select: { id: true, type: true, name: true, capacityGallons: true, customTypeLabel: true } } } },
  plan: { select: { lastCompletedAt: true, recurrenceRule: { select: { anchorDate: true } } } },
  invoices: { select: { invoiceNumber: true, status: true }, take: 1 },
} as const;

export default async function Dispatch() {
  const actor = await requireStaffPage("jobs.read");
  const tz = await companyTimeZone();
  const today = todayKey(tz);

  const [due, upcoming, recentlyDone, truck] = await Promise.all([
    prisma.job.findMany({ where: { status: { in: [...OPEN] }, scheduledDate: { lte: dateFromKey(today) } }, include, orderBy: [{ scheduledDate: "asc" }, { routeOrder: { sort: "asc", nulls: "last" } }, { windowStart: "asc" }] }),
    prisma.job.findMany({ where: { status: { in: [...OPEN] }, scheduledDate: { gt: dateFromKey(today), lte: dateFromKey(addDays(today, 14)) } }, include, orderBy: [{ scheduledDate: "asc" }, { windowStart: "asc" }], take: 60 }),
    prisma.job.findMany({ where: { status: "COMPLETED", completedAt: { gte: new Date(Date.now() - 36 * 3600_000) } }, include, orderBy: { completedAt: "desc" } }),
    prisma.vehicle.findFirst({ where: { status: { notIn: ["OUT_OF_SERVICE"] } }, orderBy: { unitNumber: "asc" }, select: { unitNumber: true, tankCapacityGallons: true } }),
  ]);

  const stop = (j: (typeof due)[number]): BoardStop => {
    const scheduled = keyFromDate(j.scheduledDate);
    // Imported plans that were already late were put on today's schedule; their real due date is the plan anchor.
    const anchor = j.plan && !j.plan.lastCompletedAt ? keyFromDate(j.plan.recurrenceRule.anchorDate) : null;
    const dueKey = anchor && compareKeys(anchor, scheduled) < 0 ? anchor : scheduled;
    const people = [
      j.location.siteContactPhone ? { name: j.location.siteContactName ?? "Site contact", phone: j.location.siteContactPhone } : null,
      ...j.location.contacts.map((c) => ({ name: c.name, phone: c.phone! })),
      ...j.organization.contacts.map((c) => ({ name: c.name, phone: c.phone! })),
      j.organization.primaryPhone ? { name: "Main line", phone: j.organization.primaryPhone } : null,
    ].filter((c): c is { name: string; phone: string } => !!c);
    const contacts = [...new Map(people.map((c) => [c.phone.replace(/\D/g, ""), c])).values()].slice(0, 2);
    return {
      id: j.id,
      jobNumber: j.jobNumber,
      status: j.status,
      emergency: j.priority === "EMERGENCY" || j.type === "EMERGENCY",
      recurring: j.type === "RECURRING",
      service: SERVICE_TYPE_LABEL[j.serviceType] ?? j.serviceType,
      serviceType: j.serviceType,
      dueKey,
      dueLabel: formatDateKey(dueKey, "weekday"),
      daysOverdue: Math.max(0, diffDays(today, dueKey)),
      scheduledKey: scheduled,
      window: j.windowStart || j.windowEnd ? formatWindow(j.windowStart, j.windowEnd) : null,
      customer: j.organization.name,
      location: j.location.name,
      locationId: j.location.id,
      address: `${j.location.addressLine1}, ${j.location.city}, ${j.location.state} ${j.location.postalCode}`,
      lat: j.location.latitude,
      lng: j.location.longitude,
      access: j.location.accessInstructions,
      estimatedGallons: j.estimatedGallons,
      cityManifest: j.location.manifestFee === "CITY_OF_HOUSTON",
      contacts,
      assets: j.assets.map((a) => ({ id: a.asset.id, label: a.asset.name || (a.asset.type === "OTHER" && a.asset.customTypeLabel ? a.asset.customTypeLabel : ASSET_TYPE_LABEL[a.asset.type] ?? "Equipment"), capacity: a.asset.capacityGallons })),
      invoice: j.invoices[0] ? `${j.invoices[0].invoiceNumber}${j.invoices[0].status === "DRAFT" ? " (draft)" : ""}` : null,
    };
  };

  // Most overdue first; emergencies due the same day go to the top of that day.
  const todo = due.map(stop).sort((a, b) => b.daysOverdue - a.daysOverdue || Number(b.emergency) - Number(a.emergency));
  const done = recentlyDone.filter((j) => j.completedAt && instantToDateKey(j.completedAt, tz) === today).map(stop);
  const capacity = truck?.tankCapacityGallons ?? TRUCK_CAPACITY_DEFAULT;

  return (
    <div>
      <PageHeader
        title="Dispatch board"
        description={formatDateKey(today, "long")}
        actions={hasPermission(actor, "customers.write") && hasPermission(actor, "jobs.write") ? <Button asChild size="sm"><Link href="/admin/new-customer"><Plus /> New Customer</Link></Button> : null}
      />
      <DispatchToday
        today={today}
        todo={todo}
        upcoming={upcoming.map(stop)}
        done={done}
        truck={{ name: truck?.unitNumber ?? "Truck 1", capacity }}
        canComplete={hasPermission(actor, "jobs.approve")}
        canReschedule={hasPermission(actor, "jobs.write")}
        mapsConfigured={integrations.maps()}
      />
    </div>
  );
}
