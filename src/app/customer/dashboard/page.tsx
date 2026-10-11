import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, CreditCard, Droplets, FileDown, LifeBuoy, Phone, Receipt, UserRound } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerDashboard, isRescheduled } from "@/server/services/customer-portal";
import { getSetting } from "@/server/services/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { CustomerJobBadge, StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { DocLink } from "@/components/portal/doc-link";
import { formatDateKey, formatWindow, relativeDays, keyFromDate } from "@/lib/dates";
import { formatCents, formatGallons } from "@/lib/money";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { telHref } from "@/lib/utils";

export const metadata = { title: "Overview" };

export default async function CustomerDashboard() {
  const { actor, scope, locationIds, selectedLocationId, selectedLocation, access } = await customerContext();
  const [d, emergency] = await Promise.all([customerDashboard(scope, locationIds, selectedLocationId), getSetting("emergency")]);
  const firstName = actor.name.split(" ")[0];
  const scopeLabel = selectedLocation ? selectedLocation.name : scope.locations.length > 1 ? `All ${scope.locations.length} locations` : scope.locations[0]?.name;
  const canPay = scope.organizations.some((o) => o.role !== "READ_ONLY" ? o.canPay : access.readOnlyCanPay && o.canPay);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={<>Your Sewer Squad account at a glance · <span className="font-medium text-foreground">{scopeLabel}</span></>}
        actions={
          <Button asChild variant="danger-outline">
            <Link href="/customer/request-service?type=emergency">
              <AlertTriangle /> Request emergency service
            </Link>
          </Button>
        }
      />

      {d.emergencies.length > 0 && (
        <Card className="border-danger/25 bg-danger-soft/40">
          <CardBody className="flex flex-wrap items-center gap-3 py-3">
            <AlertTriangle className="h-4 w-4 text-danger" aria-hidden />
            <p className="text-sm font-medium">Open emergency request{d.emergencies.length > 1 ? "s" : ""}:</p>
            {d.emergencies.map((e) => (
              <Link key={e.id} href={`/customer/request-service/${e.id}`} className="inline-flex items-center gap-2 text-sm hover:underline">
                {e.requestNumber} · {e.location.name} <StatusBadge kind="emergency" status={e.status} />
              </Link>
            ))}
          </CardBody>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Next service */}
        <Card className="flex flex-col">
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted-foreground">Next scheduled service</p>
              <CalendarClock className="h-4 w-4 text-brand" aria-hidden />
            </div>
            {d.next ? (
              <>
                <p className="mt-2 text-xl font-semibold">{formatDateKey(d.next.scheduledDate, "weekday")}</p>
                <p className="text-[13px] text-muted-foreground">
                  {formatWindow(d.next.windowStart, d.next.windowEnd)} · {relativeDays(keyFromDate(d.next.scheduledDate), d.today)}
                </p>
                <p className="mt-2 truncate text-[13px]">{d.next.location.name}</p>
                <p className="text-[13px] text-muted-foreground">{SERVICE_TYPE_LABEL[d.next.serviceType]}</p>
                <div className="mt-3 flex items-center justify-between gap-2 pt-1">
                  <CustomerJobBadge status={d.next.status} confirmedByOffice={d.next.confirmedByOffice} rescheduled={isRescheduled(d.next)} />
                  {access.allowRescheduleRequests && (
                    <Link href={`/customer/support/new?category=RESCHEDULE&jobId=${d.next.id}`} className="text-[13px] font-medium text-brand hover:underline">
                      Request change
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No upcoming services scheduled.</p>
            )}
          </CardBody>
        </Card>

        {/* Balance */}
        <Card className="flex flex-col">
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted-foreground">Outstanding balance</p>
              <Receipt className="h-4 w-4 text-brand" aria-hidden />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{formatCents(d.balanceCents)}</p>
            <p className="text-[13px] text-muted-foreground">
              {d.openInvoiceCount} open invoice{d.openInvoiceCount === 1 ? "" : "s"}
            </p>
            <div className="mt-auto pt-4">
              {d.balanceCents > 0 && canPay ? (
                <Button asChild className="w-full">
                  <Link href="/customer/invoices?status=OPEN">
                    <CreditCard /> Pay now
                  </Link>
                </Button>
              ) : (
                <Button asChild variant="secondary" className="w-full">
                  <Link href="/customer/invoices">View invoices</Link>
                </Button>
              )}
            </div>
          </CardBody>
        </Card>

        {/* Last completed */}
        <Card className="flex flex-col">
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted-foreground">Last completed service</p>
              <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            </div>
            {d.lastDone ? (
              <>
                <p className="mt-2 text-xl font-semibold">{formatDateKey(d.lastDone.scheduledDate)}</p>
                <p className="text-[13px] text-muted-foreground">
                  {formatGallons(d.lastGallons)}
                  {access.showDriverNames && d.lastDone.driver ? ` · ${d.lastDone.driver.user.name}` : ""}
                </p>
                <p className="mt-2 truncate text-[13px]">{d.lastDone.location.name}</p>
                <div className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-3">
                  {d.lastDone.manifest?.documents[0] ? <DocLink id={d.lastDone.manifest.documents[0].id}>Manifest</DocLink> : <span className="text-[13px] text-muted-foreground">Manifest pending review</span>}
                  {d.lastDone.invoices[0] && (
                    <Link href={`/customer/invoices/${d.lastDone.invoices[0].id}`} className="text-[13px] font-medium text-brand hover:underline">
                      View invoice
                    </Link>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">No completed services yet.</p>
            )}
          </CardBody>
        </Card>

        {/* Totals */}
        <Card className="flex flex-col">
          <CardBody className="flex flex-1 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[13px] font-medium text-muted-foreground">Services completed · 12 months</p>
              <Droplets className="h-4 w-4 text-brand" aria-hidden />
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{d.completedCount}</p>
            <p className="text-[13px] text-muted-foreground">{formatGallons(d.gallons12m)} pumped</p>
            <p className="mt-auto pt-3 text-[13px] text-muted-foreground">Most recent: {d.lastDone ? formatDateKey(d.lastDone.scheduledDate) : "—"}</p>
          </CardBody>
        </Card>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        {canPay && (
          <Button asChild variant="secondary">
            <Link href="/customer/invoices?status=OPEN">
              <CreditCard /> Pay invoice
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/customer/request-service?type=emergency" className="text-danger">
            <AlertTriangle /> Request emergency service
          </Link>
        </Button>
        {d.lastDone?.manifest?.documents[0] && (
          <Button asChild variant="secondary">
            <a href={`/api/documents/${d.lastDone.manifest.documents[0].id}?download=1`}>
              <FileDown /> Download latest manifest
            </a>
          </Button>
        )}
        {d.next && (
          <Button asChild variant="secondary">
            <Link href={`/customer/services/${d.next.id}`}>
              <CalendarClock /> View upcoming service
            </Link>
          </Button>
        )}
        <Button asChild variant="secondary">
          <Link href="/customer/support/new">
            <LifeBuoy /> Contact support
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader
            title="Upcoming services"
            action={
              <Link href="/customer/services" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                View all <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            }
          />
          {d.upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No upcoming services" description="When Sewer Squad schedules your next visit it will appear here." />
          ) : (
            <Table>
              <THead>
                <tr>
                  <TH>Date</TH>
                  <TH>Location</TH>
                  <TH className="hidden 2xl:table-cell">Service</TH>
                  <TH className="hidden lg:table-cell">Capacity</TH>
                  <TH>Window</TH>
                  <TH>Status</TH>
                  <TH className="text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <TBody>
                {d.upcoming.map((j) => (
                  <TR key={j.id}>
                    <TD className="whitespace-nowrap font-medium">{formatDateKey(j.scheduledDate, "weekday")}</TD>
                    <TD className="max-w-[220px] truncate">{j.location.name}</TD>
                    <TD className="hidden 2xl:table-cell">{SERVICE_TYPE_LABEL[j.serviceType]}</TD>
                    <TD className="hidden whitespace-nowrap lg:table-cell tabular-nums">
                      {j.assets.length ? `${j.assets.reduce((s, a) => s + a.asset.capacityGallons, 0).toLocaleString()} gal` : "—"}
                      {j.assets[0] && <span className="block text-[12px] text-muted-foreground">{ASSET_TYPE_LABEL[j.assets[0].asset.type]}{j.assets.length > 1 ? ` +${j.assets.length - 1}` : ""}</span>}
                    </TD>
                    <TD className="whitespace-nowrap text-[13px]">{formatWindow(j.windowStart, j.windowEnd)}</TD>
                    <TD>
                      <CustomerJobBadge status={j.status} confirmedByOffice={j.confirmedByOffice} rescheduled={isRescheduled(j)} />
                    </TD>
                    <TD className="text-right">
                      <Link href={`/customer/services/${j.id}`} className="text-[13px] font-medium text-brand hover:underline">
                        Details
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Your account representative" />
            <CardBody>
              {d.rep ? (
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-soft text-brand">
                    <UserRound className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{d.rep.name}</p>
                    {d.rep.email && (
                      <a href={`mailto:${d.rep.email}`} className="block truncate text-brand hover:underline">
                        {d.rep.email}
                      </a>
                    )}
                    {d.rep.phone && <a href={telHref(d.rep.phone)} className="block text-muted-foreground">{d.rep.phone}</a>}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Our office team will assign a representative to your account.</p>
              )}
            </CardBody>
          </Card>
          {emergency.phone && (
            <Card>
              <CardBody>
                <p className="text-[13px] font-medium text-muted-foreground">Active overflow or backup?</p>
                <Button asChild variant="danger" className="mt-3 w-full" size="lg">
                  <a href={telHref(emergency.phone)}>
                    <Phone /> Call {emergency.phone}
                  </a>
                </Button>
                <p className="mt-2 text-[12px] text-muted-foreground">Calling is the fastest way to reach dispatch.</p>
              </CardBody>
            </Card>
          )}
          {scope.locations.length > 1 && !selectedLocationId && (
            <Card>
              <CardHeader title="Your locations" description="Use the location selector to focus on one site." />
              <CardBody className="space-y-2">
                {scope.locations.slice(0, 6).map((l) => (
                  <Link key={l.id} href={`/customer/locations/${l.id}`} className="flex items-center justify-between text-sm hover:text-brand">
                    <span className="truncate">{l.name}</span>
                    <Badge>{l.city}</Badge>
                  </Link>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
