import Link from "next/link";
import { AlertTriangle, CircleDollarSign, Download, Droplets, FileWarning, Receipt } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { fleetReconciliation, unallocatedLoads } from "@/server/services/disposal";
import { reconcileEvent } from "@/domain/reconciliation";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { addDays, formatDateKey, formatInstant, isDateKey, keyFromDate, todayKey } from "@/lib/dates";
import { formatCents, formatRateCents } from "@/lib/money";
import { WASTE_TYPES } from "@/lib/status";
import { companyTimeZone } from "@/server/services/settings";
import { disposalBillSummary, listDisposalBills } from "@/server/services/disposal-bills";
import { AdminDisposalForm, BillDialog, BillStatusActions, FacilityDialog } from "./forms";

export const metadata = { title: "Disposal" };

export default async function Disposal({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; vehicle?: string; vendor?: string; status?: string }> }) {
  const actor = await requireStaffPage("disposal.read");
  const sp = await searchParams;
  const tab = sp.tab ?? "bills";
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  // Vendor bills default to year to date; truck events to the last 30 days.
  const from = sp.from && isDateKey(sp.from) ? sp.from : tab === "bills" ? `${today.slice(0, 4)}-01-01` : addDays(today, -30);
  const to = sp.to && isDateKey(sp.to) ? sp.to : today;
  const canWrite = hasPermission(actor, "disposal.write");
  const [vehicles, drivers, facilities] = await Promise.all([
    prisma.vehicle.findMany({ orderBy: { unitNumber: "asc" }, select: { id: true, unitNumber: true } }),
    prisma.driver.findMany({ where: { status: "ACTIVE" }, select: { id: true, user: { select: { name: true } } } }),
    prisma.disposalFacility.findMany({ orderBy: { name: "asc" } }),
  ]);
  const vehicleId = sp.vehicle && vehicles.some((v) => v.id === sp.vehicle) ? sp.vehicle : vehicles[0]?.id;
  return (
    <div>
      <PageHeader title="Disposal" description="Disposal events, facility records and collected-vs-disposed reconciliation." actions={tab === "bills" ? <Button asChild variant="secondary" size="sm"><a href={`/api/export/disposal-bills?${new URLSearchParams({ from, to, ...(sp.vendor ? { vendor: sp.vendor } : {}), ...(sp.status ? { status: sp.status } : {}) })}`}><Download /> Bills CSV</a></Button> : <Button asChild variant="secondary" size="sm"><a href={`/api/export/disposal?from=${from}&to=${to}`}><Download /> Reconciliation CSV</a></Button>} />
      <Tabs basePath="/admin/disposal" active={tab} tabs={[{ key: "bills", label: "Fees & bills" }, { key: "events", label: "Events" }, { key: "reconciliation", label: "Reconciliation" }, { key: "facilities", label: "Facilities", count: facilities.length }, ...(canWrite ? [{ key: "record", label: "Record event" }] : [])]} />
      {tab === "bills" && <Bills from={from} to={to} today={today} vendor={sp.vendor} status={sp.status} canWrite={canWrite} facilities={facilities.map((f) => ({ id: f.id, name: f.name, rate: f.ratePerGallonCents ? (Number(f.ratePerGallonCents) / 100).toString() : null }))} />}
      {tab === "events" && <Events from={from} to={to} tz={tz} />}
      {tab === "reconciliation" && <Recon from={from} to={to} />}
      {tab === "facilities" && (
        <Card>
          <CardHeader title="Disposal facilities" action={(canWrite || hasPermission(actor, "settings.write")) && <FacilityDialog wasteTypes={[...WASTE_TYPES]} />} />
          <Table>
            <THead><tr><TH>Facility</TH><TH>Address</TH><TH>Permit</TH><TH className="text-right">Default rate</TH><TH>Accepts</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
            <TBody>
              {facilities.map((f) => (
                <TR key={f.id}>
                  <TD className="font-medium">{f.name}<span className="block text-[12px] font-normal text-muted-foreground">{f.phone}</span>{f.vendorAccountNumber && <span className="block text-[12px] font-normal text-muted-foreground">Acct {f.vendorAccountNumber}</span>}</TD>
                  <TD className="text-[13px]">{f.addressLine1}, {f.city}, {f.state} {f.postalCode}</TD>
                  <TD>{f.permitNumber ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{f.ratePerGallonCents ? formatRateCents(f.ratePerGallonCents.toString(), "gal") : "—"}</TD>
                  <TD className="text-[13px]">{f.acceptedWasteTypes.join(", ") || "—"}</TD>
                  <TD><Badge tone={f.status === "ACTIVE" ? "success" : "neutral"}>{f.status.toLowerCase()}</Badge></TD>
                  <TD className="text-right">{(canWrite || hasPermission(actor, "settings.write")) && <FacilityDialog wasteTypes={[...WASTE_TYPES]} facility={{ id: f.id, name: f.name, addressLine1: f.addressLine1, city: f.city, state: f.state, postalCode: f.postalCode, phone: f.phone, permitNumber: f.permitNumber, acceptedWasteTypes: f.acceptedWasteTypes, status: f.status, notes: f.notes, vendorAccountNumber: f.vendorAccountNumber, remitTo: f.remitTo, billingPhone: f.billingPhone, rate: f.ratePerGallonCents ? (Number(f.ratePerGallonCents) / 100).toString() : null }} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "record" && canWrite && vehicleId && (
        <Card>
          <CardHeader title="Record disposal event" action={<div className="flex gap-1">{vehicles.map((v) => <Link key={v.id} href={`/admin/disposal?tab=record&vehicle=${v.id}`} className={`rounded-md border px-2.5 py-1 text-[13px] ${v.id === vehicleId ? "border-brand bg-brand-soft text-brand" : ""}`}>{v.unitNumber}</Link>)}</div>} />
          <CardBody>
            <AdminDisposalForm vehicleId={vehicleId} drivers={drivers.map((d) => ({ id: d.id, name: d.user.name }))} facilities={facilities.filter((f) => f.status === "ACTIVE").map((f) => ({ id: f.id, name: f.name }))} loads={await unallocatedLoads(vehicleId)} wasteTypes={[...WASTE_TYPES]} now={new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date()).replace(" ", "T")} />
          </CardBody>
        </Card>
      )}
    </div>
  );
}

async function Events({ from, to, tz }: { from: string; to: string; tz: string }) {
  const events = await prisma.disposalEvent.findMany({
    where: { disposedAt: { gte: new Date(`${from}T00:00:00Z`), lt: new Date(new Date(`${to}T00:00:00Z`).getTime() + 2 * 86_400_000) } },
    include: { facility: { select: { name: true } }, vehicle: { select: { unitNumber: true } }, driver: { select: { user: { select: { name: true } } } }, allocations: true, documents: { where: { deletedAt: null }, select: { id: true } } },
    orderBy: { disposedAt: "desc" },
    take: 300,
  });
  return (
    <Card>
      <FilterBar dates />
      <Table>
        <THead><tr><TH>Event</TH><TH>When</TH><TH>Truck · Driver</TH><TH>Facility</TH><TH className="text-right">Gallons</TH><TH className="text-right">Allocated</TH><TH className="text-right">Cost</TH><TH>Ticket</TH><TH>Check</TH></tr></THead>
        <TBody>
          {events.map((e) => {
            const allocated = e.allocations.reduce((s, a) => s + a.gallons, 0);
            const r = reconcileEvent({ gallons: e.gallons, openingLoadGallons: e.openingLoadGallons, closingLoadGallons: e.closingLoadGallons, adjustmentGallons: e.adjustmentGallons, allocatedGallons: allocated });
            return (
              <TR key={e.id}>
                <TD className="whitespace-nowrap font-medium">{e.eventNumber}</TD>
                <TD className="whitespace-nowrap text-[13px]">{formatInstant(e.disposedAt, tz)}</TD>
                <TD>{e.vehicle.unitNumber}<span className="block text-[12px] text-muted-foreground">{e.driver.user.name}</span></TD>
                <TD>{e.facility.name}</TD>
                <TD className="text-right tabular-nums">{e.gallons.toLocaleString()}</TD>
                <TD className="text-right tabular-nums">{allocated.toLocaleString()}</TD>
                <TD className="text-right tabular-nums">{formatCents(e.totalCostCents)}</TD>
                <TD className="text-[13px]">{e.ticketNumber ?? "—"}{e.documents[0] && <DocLink id={e.documents[0].id} className="ml-2">File</DocLink>}</TD>
                <TD>{r.flagged ? <Badge tone="danger"><AlertTriangle className="h-3 w-3" /> {r.discrepancyGallons > 0 ? "+" : ""}{r.discrepancyGallons} gal</Badge> : <Badge tone="success">OK</Badge>}</TD>
              </TR>
            );
          })}
          {events.length === 0 && <TR><TD colSpan={9} className="py-8 text-center text-muted-foreground">No disposal events in this range.</TD></TR>}
        </TBody>
      </Table>
    </Card>
  );
}

async function Recon({ from, to }: { from: string; to: string }) {
  const rows = await fleetReconciliation(from, to);
  const flagged = rows.filter((r) => r.flagged);
  return (
    <div className="space-y-4">
      {flagged.length > 0 && <Alert tone="danger" title="Unexplained discrepancies">{flagged.map((r) => r.vehicle.unitNumber).join(", ")}: disposed volume differs from collected volume beyond tolerance (max of 25 gal or 2%). Document adjustments or correct the records.</Alert>}
      <Card>
        <FilterBar dates />
        <Table>
          <THead><tr><TH>Truck</TH><TH className="text-right">Collected</TH><TH className="text-right">Opening</TH><TH className="text-right">Closing</TH><TH className="text-right">Adjustments</TH><TH className="text-right">Expected</TH><TH className="text-right">Disposed</TH><TH className="text-right">Difference</TH><TH className="text-right">Cost</TH></tr></THead>
          <TBody>
            {rows.map((r) => (
              <TR key={r.vehicle.id}>
                <TD className="font-medium">{r.vehicle.unitNumber}<span className="block text-[12px] font-normal text-muted-foreground">{r.events} events</span></TD>
                {[r.collectedGallons, r.openingLoadGallons, r.closingLoadGallons, r.adjustmentsGallons, r.expectedDisposedGallons, r.disposedGallons].map((n, i) => <TD key={i} className="text-right tabular-nums">{n.toLocaleString()}</TD>)}
                <TD className="text-right">{r.flagged ? <Badge tone="danger">{r.discrepancyGallons > 0 ? "+" : ""}{r.discrepancyGallons.toLocaleString()} gal</Badge> : <span className="tabular-nums text-success">{r.discrepancyGallons.toLocaleString()}</span>}</TD>
                <TD className="text-right tabular-nums">{formatCents(r.costCents)}</TD>
              </TR>
            ))}
            {rows.length === 0 && <TR><TD colSpan={9} className="py-8 text-center text-muted-foreground">No collections or disposals in this range.</TD></TR>}
          </TBody>
        </Table>
        <CardBody className="text-[12px] text-muted-foreground">Expected disposed = opening load + collected − closing load + documented adjustments. Collected volumes come from submitted service records; disposed volumes from recorded disposal events.</CardBody>
      </Card>
    </div>
  );
}

const BILL_TONE = { OPEN: "warning", PAID: "success", VOID: "neutral" } as const;

async function Bills({ from, to, today, vendor, status, canWrite, facilities }: { from: string; to: string; today: string; vendor?: string; status?: string; canWrite: boolean; facilities: { id: string; name: string; rate: string | null }[] }) {
  const filters = {
    from,
    to,
    facilityId: vendor && facilities.some((f) => f.id === vendor) ? vendor : undefined,
    status: status === "OPEN" || status === "PAID" || status === "VOID" ? status : undefined,
  } as const;
  const [bills, s] = await Promise.all([listDisposalBills(filters), disposalBillSummary({ ...filters, status: undefined })]);
  const maxMonth = Math.max(1, ...s.byMonth.map((m) => m.billedCents));
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Disposal fees billed" value={formatCents(s.billedCents)} hint={`${s.bills} bills · ${formatDateKey(from)} – ${formatDateKey(to)}`} icon={Receipt} tone="brand" />
        <Stat label="Still owed (all dates)" value={formatCents(s.openAllCents)} hint={`${s.openAllCount} open bills`} icon={FileWarning} tone={s.openAllCents > 0 ? "warning" : "success"} />
        <Stat label="Paid in range" value={formatCents(s.paidCents)} icon={CircleDollarSign} tone="success" />
        <Stat label="Average cost per gallon" value={s.centsPerGallon === null ? "—" : formatRateCents(s.centsPerGallon.toFixed(2), "gal")} hint={`${s.gallons.toLocaleString()} gal disposed`} icon={Droplets} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="min-w-0">
          <CardHeader title="By vendor" />
          <Table>
            <THead><tr><TH>Vendor</TH><TH className="text-right">Bills</TH><TH className="text-right">Gallons</TH><TH className="text-right">Billed</TH><TH className="text-right">Open</TH></tr></THead>
            <TBody>
              {s.byVendor.map((v) => (
                <TR key={v.facilityId}>
                  <TD className="font-medium"><Link href={`/admin/disposal?${new URLSearchParams({ from, to, vendor: v.facilityId })}`} className="hover:underline">{v.name}</Link></TD>
                  <TD className="text-right tabular-nums">{v.bills}</TD>
                  <TD className="text-right tabular-nums">{v.gallons.toLocaleString()}</TD>
                  <TD className="text-right tabular-nums">{formatCents(v.billedCents)}</TD>
                  <TD className="text-right tabular-nums">{v.openCents ? formatCents(v.openCents) : "—"}</TD>
                </TR>
              ))}
              {s.byVendor.length === 0 && <TR><TD colSpan={5} className="py-6 text-center text-muted-foreground">No vendor bills in this range.</TD></TR>}
            </TBody>
          </Table>
        </Card>
        <Card className="min-w-0">
          <CardHeader title="By month" />
          <Table>
            <THead><tr><TH>Month</TH><TH className="w-1/3 min-w-16"><span className="sr-only">Share</span></TH><TH className="text-right">Gallons</TH><TH className="text-right">Billed</TH></tr></THead>
            <TBody>
              {s.byMonth.map((m) => (
                <TR key={m.month}>
                  <TD className="whitespace-nowrap font-medium">{new Date(`${m.month}-01T12:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" })}</TD>
                  <TD aria-hidden><div className="h-2 rounded-full bg-brand" style={{ width: `${Math.max(2, (m.billedCents / maxMonth) * 100)}%` }} /></TD>
                  <TD className="text-right tabular-nums">{m.gallons.toLocaleString()}</TD>
                  <TD className="text-right tabular-nums">{formatCents(m.billedCents)}</TD>
                </TR>
              ))}
              {s.byMonth.length === 0 && <TR><TD colSpan={4} className="py-6 text-center text-muted-foreground">No vendor bills in this range.</TD></TR>}
            </TBody>
          </Table>
        </Card>
      </div>
      <Card>
        <CardHeader title="Vendor bills" description="What disposal sites charge us, entered from their invoices." action={canWrite && <BillDialog facilities={facilities} wasteTypes={[...WASTE_TYPES]} today={today} />} />
        <FilterBar dates selects={[{ param: "vendor", label: "Vendor", options: facilities.map((f) => ({ value: f.id, label: f.name })) }, { param: "status", label: "Status", options: [{ value: "OPEN", label: "Open" }, { value: "PAID", label: "Paid" }, { value: "VOID", label: "Void" }] }]} />
        <Table>
          <THead><tr><TH>Invoice</TH><TH>Vendor</TH><TH>Service</TH><TH>Lines</TH><TH className="text-right">Gallons</TH><TH className="text-right">Total</TH><TH>Status</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
          <TBody>
            {bills.map((b) => (
              <TR key={b.id}>
                <TD className="whitespace-nowrap font-medium">{b.vendorInvoiceNumber}<span className="block text-[12px] font-normal text-muted-foreground">{formatDateKey(keyFromDate(b.invoiceDate))}{b.dueDate && ` · due ${formatDateKey(keyFromDate(b.dueDate))}`}</span></TD>
                <TD>{b.facility.name}{b.referenceNumber && <span className="block text-[12px] text-muted-foreground">Ticket {b.referenceNumber}</span>}</TD>
                <TD className="whitespace-nowrap text-[13px]">{b.serviceDate ? formatDateKey(keyFromDate(b.serviceDate)) : "—"}</TD>
                <TD className="text-[13px]">
                  {b.lines.map((l) => (
                    <span key={l.id} className="block">{l.description}{l.gallons !== null && ` · ${l.gallons.toLocaleString()} gal`}{l.ratePerGallonCents && ` @ ${formatRateCents(l.ratePerGallonCents.toString())}`}{l.manifestNumbers.length > 0 && <span className="text-muted-foreground"> · Manifest {l.manifestNumbers.join(", ")}</span>}</span>
                  ))}
                  {b.documents[0] && <DocLink id={b.documents[0].id}>Vendor invoice</DocLink>}
                </TD>
                <TD className="text-right tabular-nums">{b.lines.reduce((t, l) => t + (l.gallons ?? 0), 0).toLocaleString()}</TD>
                <TD className={`text-right tabular-nums ${b.status === "VOID" ? "text-muted-foreground line-through" : "font-medium"}`}>{formatCents(b.totalCents)}</TD>
                <TD><Badge tone={BILL_TONE[b.status]}>{b.status.toLowerCase()}</Badge>{b.paidAt && <span className="block text-[12px] text-muted-foreground">{formatDateKey(keyFromDate(b.paidAt))}{b.paymentReference && ` · ${b.paymentReference}`}</span>}</TD>
                <TD>{canWrite && <BillStatusActions billId={b.id} status={b.status} label={b.vendorInvoiceNumber} today={today} />}</TD>
              </TR>
            ))}
            {bills.length === 0 && <TR><TD colSpan={8} className="py-8 text-center text-muted-foreground">No vendor bills match. Change the dates or add a bill.</TD></TR>}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
