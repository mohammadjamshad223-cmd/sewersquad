import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ASSET_TYPE_LABEL } from "@/lib/status";
import { todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { withLocationLabels } from "@/lib/location-label";
import { JobForm } from "./job-form";

export const metadata = { title: "New job" };

export default async function NewJob({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  await requireStaffPage("jobs.write");
  const [sp, tz] = await Promise.all([searchParams, companyTimeZone()]);
  const locations = await prisma.serviceLocation.findMany({ where: { deletedAt: null, status: "ACTIVE", organization: { status: "ACTIVE" } }, include: { organization: { select: { name: true } }, assets: { where: { deletedAt: null, status: "ACTIVE" } } }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="Schedule service" description="For an existing customer. New customers are added with New Customer, which schedules their service in the same step." breadcrumbs={[{ label: "Jobs", href: "/admin/jobs" }, { label: "New" }]} />
      <Card><CardBody>
        <JobForm
          today={todayKey(tz)}
          defaultLocationId={sp.locationId}
          locations={withLocationLabels(locations).map((l) => ({ id: l.id, label: l.label.toLowerCase().includes(l.organization.name.toLowerCase()) ? l.label : `${l.label} · ${l.organization.name}`, windowStart: l.defaultWindowStart, windowEnd: l.defaultWindowEnd, assets: l.assets.map((a) => ({ id: a.id, label: `${a.assetTag} · ${ASSET_TYPE_LABEL[a.type]} ${a.capacityGallons.toLocaleString()} gal`, capacity: a.capacityGallons })) }))}
        />
      </CardBody></Card>
    </div>
  );
}
