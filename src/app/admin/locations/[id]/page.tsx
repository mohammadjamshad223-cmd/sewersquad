import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarPlus } from "lucide-react";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { assetHistory } from "@/server/services/customers";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, DescriptionList, EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { AssetDialog, LocationDialog, PlanDialog, ReasonDialog } from "@/components/admin/dialogs";
import { setLocationStatusAction, setPlanStatusAction } from "@/app/admin/_actions/customers";
import { describeRule, previewOccurrences } from "@/domain/recurrence";
import { ruleFromRecord } from "@/server/services/plans";
import { formatDateKey, formatInstant, formatWindow, keyFromDate, todayKey } from "@/lib/dates";
import { formatRateCents, formatCents, formatGallons } from "@/lib/money";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatAddress, titleCase } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";
import { AuditTrail } from "@/components/admin/audit-trail";
import { StopsMap } from "@/components/maps/stops-map";
import { AutoGeocode } from "@/components/maps/auto-geocode";
import { integrations } from "@/server/env";

export const metadata = { title: "Location" };

export default async function LocationDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string; asset?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("customers.read");
  const loc = await prisma.serviceLocation.findFirst({
    where: { id, deletedAt: null },
    include: {
      organization: { include: { billingProfiles: { select: { id: true, name: true } } } },
      assets: { where: { deletedAt: null }, orderBy: { assetTag: "asc" } },
      plans: { include: { recurrenceRule: true, assets: { include: { asset: { select: { assetTag: true } } } } }, orderBy: { createdAt: "asc" } },
      jobs: { orderBy: { scheduledDate: "desc" }, take: 20, include: { driver: { select: { user: { select: { name: true } } } } } },
    },
  });
  if (!loc) notFound();
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const tab = sp.tab ?? "overview";
  const canWrite = hasPermission(actor, "customers.write");
  const canPlan = hasPermission(actor, "plans.write");
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { status: "ACTIVE" }, select: { id: true, user: { select: { name: true } } } }),
    prisma.vehicle.findMany({ select: { id: true, unitNumber: true }, orderBy: { unitNumber: "asc" } }),
  ]);
  const assetOpts = loc.assets.filter((a) => a.status === "ACTIVE").map((a) => ({ id: a.id, label: `${a.assetTag} · ${ASSET_TYPE_LABEL[a.type]} ${a.capacityGallons.toLocaleString()} gal` }));
  const selectedAsset = sp.asset ? loc.assets.find((a) => a.id === sp.asset) : null;
  const history = selectedAsset ? await assetHistory(selectedAsset.id) : [];
  const driverOpts = drivers.map((d) => ({ id: d.id, name: d.user.name }));

  return (
    <div>
      <PageHeader
        title={loc.name}
        description={formatAddress(loc)}
        breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: loc.organization.name, href: `/admin/customers/${loc.organizationId}?tab=locations` }, { label: loc.name }]}
        actions={
          <>
            <Badge tone={loc.status === "ACTIVE" ? "success" : "neutral"} dot>{titleCase(loc.status)}</Badge>
            {hasPermission(actor, "jobs.write") && <Button asChild size="sm" variant="secondary"><Link href={`/admin/jobs/new?locationId=${loc.id}`}><CalendarPlus /> Schedule job</Link></Button>}
            {canWrite && <LocationDialog trigger={{ label: "Edit", icon: "edit" }} title="Edit location" loc={{ id: loc.id, name: loc.name, addressLine1: loc.addressLine1, addressLine2: loc.addressLine2, city: loc.city, state: loc.state, postalCode: loc.postalCode, county: loc.county, siteContactName: loc.siteContactName, siteContactPhone: loc.siteContactPhone, siteContactEmail: loc.siteContactEmail, accessInstructions: loc.accessInstructions, specialRequirements: loc.specialRequirements, territory: loc.territory, defaultWindowStart: loc.defaultWindowStart, defaultWindowEnd: loc.defaultWindowEnd, latitude: loc.latitude, longitude: loc.longitude, billingProfileId: loc.billingProfileId, manifestFee: loc.manifestFee }} billingProfiles={loc.organization.billingProfiles} />}
            {hasPermission(actor, "customers.deactivate") && (
              <ReasonDialog trigger={{ label: loc.status === "ACTIVE" ? "Deactivate" : "Reactivate", variant: loc.status === "ACTIVE" ? "danger-outline" : "secondary" }} title={loc.status === "ACTIVE" ? "Deactivate location" : "Reactivate location"} description={loc.status === "ACTIVE" ? "Active plans for this location will be paused." : undefined} action={setLocationStatusAction} hidden={{ id: loc.id, active: loc.status === "ACTIVE" ? "false" : "true" }} reasonRequired={loc.status === "ACTIVE"} submitLabel="Confirm" submitVariant={loc.status === "ACTIVE" ? "danger" : "primary"} />
            )}
          </>
        }
      />
      {sp.created && <Alert tone="success" className="mb-5" title="Location created">Register its equipment, then create a recurring service plan.</Alert>}
      <Tabs basePath={`/admin/locations/${loc.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "equipment", label: "Equipment", count: loc.assets.length }, { key: "plans", label: "Service plans", count: loc.plans.length }, { key: "jobs", label: "Jobs" }, { key: "activity", label: "Activity" }]} />

      {tab === "overview" && (
        <Card>
          <CardBody>
            <DescriptionList columns={3} items={[
              { label: "Location code", value: loc.code },
              { label: "Customer", value: <Link href={`/admin/customers/${loc.organizationId}`} className="text-brand hover:underline">{loc.organization.name}</Link> },
              { label: "Territory", value: loc.territory },
              { label: "Site contact", value: [loc.siteContactName, loc.siteContactPhone, loc.siteContactEmail].filter(Boolean).join(" · ") || null },
              { label: "Default window", value: formatWindow(loc.defaultWindowStart, loc.defaultWindowEnd) },
              { label: "Coordinates", value: loc.latitude && loc.longitude ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}` : "Not set" },
              { label: "Access instructions", value: loc.accessInstructions },
              { label: "Special requirements", value: loc.specialRequirements },
              { label: "Billing profile", value: loc.organization.billingProfiles.find((b) => b.id === loc.billingProfileId)?.name ?? "Customer default" },
            ]} />
            {integrations.maps() && (
              <div className="mt-5 space-y-2">
                {loc.latitude === null || loc.longitude === null ? (
                  <AutoGeocode items={[{ id: loc.id, name: loc.name, address: `${loc.addressLine1}, ${loc.city}, ${loc.state} ${loc.postalCode}` }]} />
                ) : (
                  <StopsMap label={`Map of ${loc.name}`} height={280} points={[{ id: loc.id, lat: loc.latitude, lng: loc.longitude, title: loc.name, subtitle: formatAddress(loc), color: "#002957" }]} />
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {tab === "equipment" && (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Equipment" description="Select an asset to see its chronological service history." action={canWrite && <AssetDialog trigger={{ label: "Add equipment", icon: "plus", variant: "primary" }} title="Add equipment" locationId={loc.id} />} />
            {loc.assets.length === 0 ? <EmptyState title="No equipment registered" /> : (
              <Table>
                <THead><tr><TH>Asset</TH><TH>Type</TH><TH className="text-right">Capacity</TH><TH>Placement</TH><TH className="hidden lg:table-cell">Installed at</TH><TH>Last serviced</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
                <TBody>
                  {loc.assets.map((a) => (
                    <TR key={a.id} className={a.id === sp.asset ? "bg-brand-soft/40" : undefined}>
                      <TD className="whitespace-nowrap"><Link href={`/admin/locations/${loc.id}?tab=equipment&asset=${a.id}`} className="font-mono font-medium hover:text-brand">{a.assetTag}</Link></TD>
                      <TD>{a.type === "OTHER" ? a.customTypeLabel : ASSET_TYPE_LABEL[a.type]}{a.name && <span className="block text-[12px] text-muted-foreground">{a.name}</span>}</TD>
                      <TD className="text-right tabular-nums">{a.capacityGallons.toLocaleString()} gal</TD>
                      <TD>{titleCase(a.placement)}</TD>
                      <TD className="hidden lg:table-cell text-[13px]">{a.installLocation ?? "—"}</TD>
                      <TD className="whitespace-nowrap">{a.lastServicedAt ? formatInstant(a.lastServicedAt, tz, "date") : "—"}</TD>
                      <TD><Badge tone={a.status === "ACTIVE" ? "success" : "neutral"}>{titleCase(a.status)}</Badge></TD>
                      <TD className="text-right">{canWrite && <AssetDialog trigger={{ label: "Edit", variant: "ghost" }} title={`Edit ${a.assetTag}`} locationId={loc.id} asset={{ id: a.id, type: a.type, customTypeLabel: a.customTypeLabel, name: a.name, capacityGallons: a.capacityGallons, placement: a.placement, installLocation: a.installLocation, accessInstructions: a.accessInstructions, requiredEquipment: a.requiredEquipment, frequencyDays: a.frequencyDays, notes: a.notes, status: a.status }} />}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
          {selectedAsset && (
            <Card>
              <CardHeader title={`Service history · ${selectedAsset.assetTag}`} />
              <Table>
                <THead><tr><TH>Date</TH><TH>Job</TH><TH className="text-right">Pumped</TH><TH>Service</TH><TH>Driver</TH><TH>Manifest</TH></tr></THead>
                <TBody>
                  {history.map((h) => (
                    <TR key={h.id}>
                      <TD className="whitespace-nowrap">{formatDateKey(h.serviceRecord.job.scheduledDate)}</TD>
                      <TD><Link href={`/admin/jobs/${h.serviceRecord.job.id}`} className="font-medium hover:text-brand">{h.serviceRecord.job.jobNumber}</Link></TD>
                      <TD className="text-right tabular-nums">{formatGallons(h.gallonsPumped)}</TD>
                      <TD>{h.servicePerformed ?? "—"}</TD>
                      <TD>{h.serviceRecord.driver.user.name}</TD>
                      <TD>{h.serviceRecord.job.manifest ? <Link href={`/admin/manifests/${h.serviceRecord.job.manifest.id}`} className="hover:text-brand">{h.serviceRecord.job.manifest.manifestNumber}</Link> : "—"}</TD>
                    </TR>
                  ))}
                  {history.length === 0 && <TR><TD colSpan={6} className="py-6 text-center text-muted-foreground">No service recorded yet.</TD></TR>}
                </TBody>
              </Table>
            </Card>
          )}
        </div>
      )}

      {tab === "plans" && (
        <div className="space-y-4">
          <div className="flex justify-end">{canPlan && <PlanDialog trigger={{ label: "New recurring plan", icon: "plus", variant: "primary", size: "md" }} title="New recurring service plan" locationId={loc.id} assets={assetOpts} drivers={driverOpts} vehicles={vehicles} today={today} />}</div>
          {loc.plans.length === 0 && <Card><EmptyState title="No service plans" description="Create a recurring plan to schedule visits automatically." /></Card>}
          {loc.plans.map((p) => {
            const rule = ruleFromRecord(p.recurrenceRule);
            const preview = p.status === "ACTIVE" && p.nextServiceDate ? previewOccurrences({ ...rule }, keyFromDate(p.nextServiceDate), 5) : [];
            return (
              <Card key={p.id}>
                <CardHeader
                  title={<span className="flex items-center gap-2">{p.name}<Badge tone={p.status === "ACTIVE" ? "success" : p.status === "PAUSED" ? "warning" : "neutral"}>{titleCase(p.status)}</Badge></span>}
                  description={`${p.planNumber} · ${SERVICE_TYPE_LABEL[p.serviceType]} · ${describeRule(rule)}`}
                  action={canPlan && (
                    <>
                      <PlanDialog trigger={{ label: "Edit", variant: "ghost" }} title={`Edit ${p.planNumber}`} locationId={loc.id} assets={assetOpts} drivers={driverOpts} vehicles={vehicles} today={today}
                        plan={{ id: p.id, name: p.name, serviceType: p.serviceType, unit: rule.unit, interval: rule.interval, anchor: rule.anchor, startDate: keyFromDate(p.startDate), endDate: p.endDate ? keyFromDate(p.endDate) : null, specificDates: (rule.specificDates ?? []).join("\n"), preferredWindowStart: p.preferredWindowStart, preferredWindowEnd: p.preferredWindowEnd, pricingModel: p.pricingModel, flatPriceCents: p.flatPriceCents, perGallon: p.perGallonCents ? (Number(p.perGallonCents) / 100).toString() : null, minimumChargeCents: p.minimumChargeCents, territory: p.territory, defaultDriverId: p.defaultDriverId, defaultVehicleId: p.defaultVehicleId, specialInstructions: p.specialInstructions, assetIds: p.assets.map((a) => a.assetId) }} />
                      {p.status !== "ENDED" && <ReasonDialog trigger={{ label: p.status === "ACTIVE" ? "Pause" : "Resume", variant: "ghost" }} title={p.status === "ACTIVE" ? "Pause plan" : "Resume plan"} description={p.status === "ACTIVE" ? "The not-yet-started upcoming visit will be cancelled. No new visits are generated while paused." : "Scheduling resumes from the next occurrence on or after today."} action={setPlanStatusAction} hidden={{ planId: p.id, status: p.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }} submitLabel="Confirm" />}
                      {p.status !== "ENDED" && <ReasonDialog trigger={{ label: "End", variant: "ghost" }} title="End plan" action={setPlanStatusAction} hidden={{ planId: p.id, status: "ENDED" }} submitLabel="End plan" submitVariant="danger" />}
                    </>
                  )}
                />
                <CardBody>
                  <DescriptionList columns={3} items={[
                    { label: "Next service", value: p.nextServiceDate ? formatDateKey(p.nextServiceDate, "long") : "—" },
                    { label: "Window", value: formatWindow(p.preferredWindowStart, p.preferredWindowEnd) },
                    { label: "Pricing", value: p.pricingModel === "FLAT_RATE" ? (p.flatPriceCents !== null ? `${formatCents(p.flatPriceCents)} flat` : "Company rules") : p.perGallonCents ? `${formatRateCents(p.perGallonCents.toString(), "gal")}${p.minimumChargeCents ? `, min ${formatCents(p.minimumChargeCents)}` : ""}` : "Company rules" },
                    { label: "Equipment", value: p.assets.map((a) => a.asset.assetTag).join(", ") },
                    { label: "Default driver", value: drivers.find((d) => d.id === p.defaultDriverId)?.user.name ?? "Assigned on dispatch" },
                    { label: "Upcoming (preview)", value: preview.length ? preview.map((d) => formatDateKey(d)).join(" · ") : "—" },
                  ]} />
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {tab === "jobs" && (
        <Card>
          <Table>
            <THead><tr><TH>Date</TH><TH>Job</TH><TH>Type</TH><TH>Driver</TH><TH>Status</TH></tr></THead>
            <TBody>
              {loc.jobs.map((j) => (
                <TR key={j.id}>
                  <TD className="whitespace-nowrap">{formatDateKey(j.scheduledDate)}</TD>
                  <TD><Link href={`/admin/jobs/${j.id}`} className="font-medium hover:text-brand">{j.jobNumber}</Link></TD>
                  <TD>{titleCase(j.type)}</TD><TD>{j.driver?.user.name ?? "—"}</TD>
                  <TD><StatusBadge kind="job" status={j.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "activity" && hasPermission(actor, "audit.read") && <AuditTrail where={{ OR: [{ entityId: loc.id }, { entityType: "ServiceAsset", entityId: { in: loc.assets.map((a) => a.id) } }, { entityType: "ServicePlan", entityId: { in: loc.plans.map((p) => p.id) } }] }} />}
    </div>
  );
}
