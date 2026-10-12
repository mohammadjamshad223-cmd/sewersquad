import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { planCapacity } from "@/domain/capacity";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { addDays, dateFromKey, formatDateKey, formatWindow, isDateKey, keyFromDate, todayKey } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { integrations } from "@/server/env";
import { DispatchBoard, type BoardColumn, type BoardJob } from "./board";
import { StopsMap } from "@/components/maps/stops-map";
import { AutoGeocode } from "@/components/maps/auto-geocode";
import { cn } from "@/lib/utils";

export const metadata = { title: "Dispatch board" };

const VISIBLE = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION", "SUBMITTED", "COMPLETED", "UNABLE_TO_SERVICE", "MISSED"] as const;

export default async function Dispatch({ searchParams }: { searchParams: Promise<{ date?: string; tab?: string }> }) {
  const actor = await requireStaffPage("jobs.read");
  const sp = await searchParams;
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const date = sp.date && isDateKey(sp.date) ? sp.date : today;
  const view = sp.tab ?? "drivers";
  const nav = (d: string) => `/admin/dispatch?${new URLSearchParams({ date: d, ...(view !== "drivers" ? { tab: view } : {}) })}`;

  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { status: "ACTIVE", user: { status: "ACTIVE" } }, include: { user: { select: { name: true } }, defaultVehicle: true }, orderBy: { user: { name: "asc" } } }),
    prisma.vehicle.findMany({ orderBy: { unitNumber: "asc" } }),
  ]);
  const weekStart = addDays(date, -((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7));
  const range = view === "week" ? { gte: dateFromKey(weekStart), lte: dateFromKey(addDays(weekStart, 6)) } : dateFromKey(date);
  const jobs = await prisma.job.findMany({
    where: { scheduledDate: range, status: { in: [...VISIBLE] } },
    include: { location: { select: { id: true, name: true, addressLine1: true, city: true, state: true, postalCode: true, latitude: true, longitude: true, territory: true } } },
    orderBy: [{ priority: "desc" }, { routeOrder: { sort: "asc", nulls: "last" } }, { windowStart: "asc" }],
  });
  const card = (j: (typeof jobs)[number]): BoardJob => ({ id: j.id, jobNumber: j.jobNumber, status: j.status, priority: j.priority, location: j.location.name, city: j.location.city, window: formatWindow(j.windowStart, j.windowEnd), estimatedGallons: j.estimatedGallons, driverId: j.driverId, vehicleId: j.vehicleId, routeOrder: j.routeOrder });
  const column = (base: Omit<BoardColumn, "warnings" | "load">): BoardColumn => {
    const open = base.jobs;
    const cap = base.capacity ? planCapacity(base.capacity, open.map((j) => ({ kind: "service", id: j.id, label: j.location, estimatedGallons: j.estimatedGallons }))) : null;
    return { ...base, warnings: cap?.warnings ?? [], load: cap?.totalEstimated ?? open.reduce((s, j) => s + (j.estimatedGallons ?? 0), 0) };
  };
  const unassigned = jobs.filter((j) => !j.driverId).map(card);
  const columns: BoardColumn[] =
    view === "trucks"
      ? [column({ id: "u", title: "Unassigned", subtitle: "Needs a driver and truck", kind: "unassigned", driverId: null, vehicleId: null, capacity: null, jobs: unassigned }), ...vehicles.map((v) => column({ id: v.id, title: `Truck ${v.unitNumber}`, subtitle: `${v.tankCapacityGallons.toLocaleString()} gal · ${v.status.replace(/_/g, " ").toLowerCase()}`, kind: "truck", driverId: null, vehicleId: v.id, capacity: v.tankCapacityGallons, jobs: jobs.filter((j) => j.vehicleId === v.id).map(card) }))]
      : [column({ id: "u", title: "Unassigned", subtitle: "Drag onto a driver to assign", kind: "unassigned", driverId: null, vehicleId: null, capacity: null, jobs: unassigned }), ...drivers.map((d) => column({ id: d.id, title: d.user.name, subtitle: `${d.defaultVehicle ? `Truck ${d.defaultVehicle.unitNumber}` : "No truck"}${d.territory ? ` · ${d.territory}` : ""}`, kind: "driver", driverId: d.id, vehicleId: d.defaultVehicleId, capacity: d.defaultVehicle?.tankCapacityGallons ?? null, jobs: jobs.filter((j) => j.driverId === d.id).map(card) }))];

  const emergencies = jobs.filter((j) => j.priority === "EMERGENCY" && !j.driverId).length;

  return (
    <div>
      <PageHeader
        title="Dispatch board"
        description={view === "week" ? `Week of ${formatDateKey(weekStart, "long")}` : formatDateKey(date, "long")}
        actions={
          <>
            <Button asChild variant="secondary" size="icon" aria-label="Previous"><Link href={nav(addDays(date, view === "week" ? -7 : -1))}><ChevronLeft /></Link></Button>
            <Button asChild variant="secondary" size="sm"><Link href={nav(today)}>Today</Link></Button>
            <Button asChild variant="secondary" size="icon" aria-label="Next"><Link href={nav(addDays(date, view === "week" ? 7 : 1))}><ChevronRight /></Link></Button>
            {hasPermission(actor, "jobs.write") && <Button asChild size="sm"><Link href="/admin/jobs/new"><Plus /> New job</Link></Button>}
          </>
        }
      />
      <Tabs basePath="/admin/dispatch" active={view} extra={{ date }} tabs={[{ key: "drivers", label: "By driver" }, { key: "trucks", label: "By truck" }, { key: "week", label: "Week" }, { key: "map", label: "Map" }]} />
      {emergencies > 0 && <Alert tone="danger" title={`${emergencies} unassigned emergency job${emergencies > 1 ? "s" : ""}`} className="mb-4">Emergencies are listed first in the Unassigned column.</Alert>}
      {(view === "drivers" || view === "trucks") && (
        <>
          <DispatchBoard date={date} columns={columns} drivers={drivers.map((d) => ({ id: d.id, name: d.user.name, vehicleId: d.defaultVehicleId }))} />
          <p className="mt-2 text-[12px] text-muted-foreground">Load estimates use each job&apos;s estimated gallons against the assigned truck&apos;s tank and assume no mid-route disposal. Stop order is set manually — no automatic route optimization is applied.</p>
        </>
      )}
      {view === "week" && (
        <Card>
          <Table>
            <THead><tr><TH>Driver</TH>{Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => <TH key={d} className={cn("text-center", d === today && "text-brand")}>{formatDateKey(d, "weekday")}</TH>)}</tr></THead>
            <TBody>
              {[{ id: null as string | null, name: "Unassigned" }, ...drivers.map((d) => ({ id: d.id as string | null, name: d.user.name }))].map((row) => (
                <TR key={row.id ?? "u"}>
                  <TD className="font-medium">{row.name}</TD>
                  {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
                    const list = jobs.filter((j) => j.driverId === row.id && keyFromDate(j.scheduledDate) === d);
                    const gal = list.reduce((s, j) => s + (j.estimatedGallons ?? 0), 0);
                    return (
                      <TD key={d} className="text-center">
                        {list.length ? <Link href={`/admin/dispatch?date=${d}`} className={cn("inline-block rounded-md px-2 py-1 text-[13px] hover:bg-subtle", row.id === null && "text-warning")}><span className="font-semibold tabular-nums">{list.length}</span><span className="block text-[11px] text-muted-foreground">{gal.toLocaleString()} gal</span></Link> : <span className="text-muted-foreground">—</span>}
                      </TD>
                    );
                  })}
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {view === "map" && <GeoView jobs={jobs.map((j) => ({ id: j.id, jobNumber: j.jobNumber, name: j.location.name, lat: j.location.latitude, lng: j.location.longitude, driverId: j.driverId, territory: j.location.territory, locationId: j.location.id, address: `${j.location.addressLine1}, ${j.location.city}, ${j.location.state} ${j.location.postalCode}` }))} drivers={drivers.map((d) => ({ id: d.id, name: d.user.name }))} mapsConfigured={integrations.maps()} />}
    </div>
  );
}

type GeoJob = { id: string; jobNumber: string; name: string; lat: number | null; lng: number | null; driverId: string | null; territory: string | null; locationId: string; address: string };

/** Stops colored by driver: a Google map when a Maps key is configured, otherwise a schematic plot. */
function GeoView({ jobs, drivers, mapsConfigured }: { jobs: GeoJob[]; drivers: { id: string; name: string }[]; mapsConfigured: boolean }) {
  const pts = jobs.filter((j) => j.lat !== null && j.lng !== null);
  // Only the first three categorical slots stay distinguishable pairwise; more drivers fold into "Other".
  const palette = ["#2a78d6", "#eb6834", "#1baf7a"];
  const OTHER = "#a3a29c";
  const UNASSIGNED = "#52514e";
  const color = (driverId: string | null) => {
    if (!driverId) return UNASSIGNED;
    const i = drivers.findIndex((d) => d.id === driverId);
    return i >= 0 && i < palette.length ? palette[i]! : OTHER;
  };
  const driverName = (driverId: string | null) => drivers.find((d) => d.id === driverId)?.name ?? "Unassigned";
  const missing = [...new Map(jobs.filter((j) => j.lat === null || j.lng === null).map((j) => [j.locationId, { id: j.locationId, name: j.name, address: j.address }])).values()];
  const legend = (
    <ul className="mt-3 flex flex-wrap gap-4 text-[12px]">
      <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: UNASSIGNED }} />Unassigned</li>
      {drivers.slice(0, 3).map((d) => <li key={d.id} className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: color(d.id) }} />{d.name}</li>)}
      {drivers.length > 3 && <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: OTHER }} />Other drivers ({drivers.length - 3})</li>}
    </ul>
  );

  if (mapsConfigured) {
    return (
      <Card>
        <CardHeader title="Stop map" description={`${pts.length} of ${jobs.length} stops placed. Click a dot for the job.`} />
        <CardBody className="space-y-2">
          <AutoGeocode items={missing} />
          <StopsMap label="Map of stops colored by driver" points={pts.map((p) => ({ id: p.id, lat: p.lat!, lng: p.lng!, title: p.name, subtitle: `${p.jobNumber} · ${driverName(p.driverId)}`, color: color(p.driverId), href: `/admin/jobs/${p.id}` }))} />
          {legend}
        </CardBody>
      </Card>
    );
  }
  return <SchematicView pts={pts} color={color} legend={legend} />;
}

/** Schematic geographic grouping (no basemap tiles), used until a Maps key is configured. */
function SchematicView({ pts, color, legend }: { pts: GeoJob[]; color: (driverId: string | null) => string; legend: React.ReactNode }) {
  if (pts.length === 0) return <Card><CardBody className="text-sm text-muted-foreground">No stops with coordinates for this day. Add latitude/longitude on locations, or add a Google Maps key so addresses are placed automatically.</CardBody></Card>;
  const lats = pts.map((p) => p.lat!), lngs = pts.map((p) => p.lng!);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const pad = 0.05;
  const x = (lng: number) => ((lng - minLng + pad) / (maxLng - minLng + 2 * pad || 1)) * 760 + 20;
  const y = (lat: number) => 380 - ((lat - minLat + pad) / (maxLat - minLat + 2 * pad || 1)) * 360;
  return (
    <Card>
      <CardHeader title="Stop locations (schematic)" description="No maps provider is configured (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY), so this is a schematic plot without streets." />
      <CardBody>
        <svg viewBox="0 0 800 400" className="w-full rounded-md border bg-white" role="img" aria-label="Schematic plot of stop locations colored by driver">
          {pts.map((p) => (
            <g key={p.id}>
              <circle cx={x(p.lng!)} cy={y(p.lat!)} r={7} fill={color(p.driverId)} stroke="#fff" strokeWidth={2}><title>{p.name}</title></circle>
              <text x={x(p.lng!) + 10} y={y(p.lat!) + 4} fontSize={11} fill="#52514e">{p.name.length > 28 ? `${p.name.slice(0, 28)}…` : p.name}</text>
            </g>
          ))}
        </svg>
        {legend}
      </CardBody>
    </Card>
  );
}
