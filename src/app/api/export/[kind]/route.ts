import type { NextRequest } from "next/server";
import { assertSignedIn, assertStaffActor } from "@/server/authz/guards";
import { customerScopeFor, invoiceScopedWhere } from "@/server/authz/scope";
import { prisma } from "@/server/db";
import { csvResponse, route } from "@/server/route";
import { notFound } from "@/server/errors";
import { manifestListWhere } from "@/server/services/manifests";
import { formatInstant, keyFromDate, isDateKey, dateFromKey, todayKey, addDays } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { operationsMetrics, receivablesAging, revenueBreakdowns, monthlySeries, serviceContribution } from "@/server/services/analytics";
import { fleetReconciliation } from "@/server/services/disposal";
import { listDisposalBills } from "@/server/services/disposal-bills";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";
const c = (cents: number | null | undefined) => (cents === null || cents === undefined ? "" : (cents / 100).toFixed(2));

/** CSV exports. Every export respects the caller's permissions and data scope. */
export const GET = route(async (req: NextRequest, ctx: { params: Promise<{ kind: string }> }) => {
  const actor = await assertSignedIn();
  const { kind } = await ctx.params;
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const tz = await companyTimeZone();
  const today = todayKey(tz);
  const from = sp.from && isDateKey(sp.from) ? sp.from : addDays(today, -365);
  const to = sp.to && isDateKey(sp.to) ? sp.to : today;
  const stamp = today;

  // Customer-scoped location filter (staff: all).
  let locationIds: string[] | undefined;
  let invoiceWhere: Prisma.InvoiceWhereInput = {};
  if (actor.kind === "CUSTOMER") {
    const scope = await customerScopeFor(actor);
    locationIds = sp.location && scope.locationIds.includes(sp.location) ? [sp.location] : scope.locationIds;
    invoiceWhere = invoiceScopedWhere(scope, sp.location ?? null);
  } else if (actor.kind === "DRIVER") throw notFound();

  switch (kind) {
    case "manifests": {
      if (actor.kind === "STAFF") assertStaffActor(actor, "manifests.read");
      const where = manifestListWhere({ ...sp, locationIds, ...(actor.kind === "CUSTOMER" ? { status: "FINALIZED" } : {}) });
      const rows = await prisma.manifest.findMany({ where, include: { organization: true, location: true, job: { select: { jobNumber: true } } }, orderBy: { serviceDate: "desc" }, take: 10_000 });
      return csvResponse(`manifests-${stamp}.csv`, [
        ["Manifest #", "Status", "Service date", "Customer", "Location", "Address", "Job #", "Waste type", "Gallons", "Driver", "Version", "Finalized at"],
        ...rows.map((m) => [m.manifestNumber, m.status, keyFromDate(m.serviceDate), m.organization.name, m.location.name, `${m.location.addressLine1}, ${m.location.city}`, m.job.jobNumber, m.wasteType, m.totalGallons, m.driverName, m.currentVersion, m.finalizedAt ? formatInstant(m.finalizedAt, tz) : ""]),
      ]);
    }
    case "invoices": {
      if (actor.kind === "STAFF") assertStaffActor(actor, "invoices.read");
      const rows = await prisma.invoice.findMany({
        where: { AND: [invoiceWhere, { issueDate: { gte: dateFromKey(from), lte: dateFromKey(to) } }, sp.status ? { status: sp.status as never } : {}] },
        include: { organization: true, serviceLocation: true },
        orderBy: { issueDate: "desc" },
        take: 10_000,
      });
      return csvResponse(`invoices-${stamp}.csv`, [
        ["Invoice #", "Status", "Issue date", "Due date", "Customer", "Service location", "Subtotal", "Discount", "Tax", "Total", "Paid", "Balance"],
        ...rows.map((i) => [i.invoiceNumber, i.status, keyFromDate(i.issueDate), keyFromDate(i.dueDate), i.organization.name, i.serviceLocation?.name ?? "", c(i.subtotalCents), c(i.discountCents), c(i.taxCents), c(i.totalCents), c(i.amountPaidCents), c(i.balanceCents)]),
      ]);
    }
    case "service-history": {
      const rows = await prisma.job.findMany({
        where: { status: { in: ["SUBMITTED", "COMPLETED"] }, scheduledDate: { gte: dateFromKey(from), lte: dateFromKey(to) }, ...(locationIds ? { locationId: { in: locationIds } } : {}) },
        include: { location: true, organization: true, serviceRecord: { include: { assetRecords: true } }, manifest: { select: { manifestNumber: true } } },
        orderBy: { scheduledDate: "desc" },
        take: 10_000,
      });
      if (actor.kind === "STAFF") assertStaffActor(actor, "jobs.read");
      return csvResponse(`service-history-${stamp}.csv`, [
        ["Date", "Job #", "Customer", "Location", "Service type", "Gallons pumped", "Manifest #"],
        ...rows.map((j) => [keyFromDate(j.scheduledDate), j.jobNumber, j.organization.name, j.location.name, j.serviceType, j.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0, j.manifest?.manifestNumber ?? ""]),
      ]);
    }
    case "aging": {
      assertStaffActor(actor, "reports.financial");
      const rows = await receivablesAging();
      return csvResponse(`ar-aging-${stamp}.csv`, [["Bucket", "Balance"], ...rows.map((r) => [r.label, c(r.cents)])]);
    }
    case "revenue": {
      assertStaffActor(actor, "reports.financial");
      const [monthly, b] = await Promise.all([monthlySeries(12), revenueBreakdowns(from, to)]);
      return csvResponse(`revenue-${stamp}.csv`, [
        ["Section", "Name", "Amount"],
        ...monthly.map((m) => ["Revenue by month", m.label, c(m.revenueCents)]),
        ...monthly.map((m) => ["Payments collected by month", m.label, c(m.collectedCents)]),
        ...b.byService.map((r) => ["Revenue by service type", r.name, c(r.cents)]),
        ...b.byCustomer.map((r) => ["Revenue by customer", r.name, c(r.cents)]),
        ...b.byLocation.map((r) => ["Revenue by location", r.name, c(r.cents)]),
      ]);
    }
    case "operations": {
      assertStaffActor(actor, "reports.operations");
      const m = await operationsMetrics(from, to);
      return csvResponse(`operations-${stamp}.csv`, [
        ["Date", "Jobs completed", "Gallons pumped"],
        ...m.perDay.map((d) => [d.date, d.jobs, d.gallons]),
        [],
        ["Driver", "Jobs", "Gallons"],
        ...m.perDriver.map((d) => [d.name, d.jobs, d.gallons]),
        [],
        ["Scheduled", m.scheduled],
        ["Completed", m.completed],
        ["Missed / unable", m.missed],
      ]);
    }
    case "contribution": {
      assertStaffActor(actor, "reports.financial");
      const rows = await serviceContribution(from, to);
      return csvResponse(`service-contribution-${stamp}.csv`, [
        ["Date", "Job #", "Customer", "Location", "Gallons", "Revenue", "Direct cost", "Contribution", "Margin %", "Complete", "Missing cost inputs"],
        ...rows.map((r) => [keyFromDate(r.date), r.jobNumber, r.customer, r.location, r.gallons, c(r.revenueCents), c(r.directCostCents), c(r.contributionCents), r.marginRatio === null ? "" : (r.marginRatio * 100).toFixed(1), r.complete ? "yes" : "ESTIMATE", r.missing.join("; ")]),
      ]);
    }
    case "disposal": {
      assertStaffActor(actor, "disposal.read");
      const rows = await fleetReconciliation(from, to);
      return csvResponse(`disposal-reconciliation-${stamp}.csv`, [
        ["Truck", "Collected gal", "Disposed gal", "Opening", "Closing", "Adjustments", "Expected", "Discrepancy", "Flagged", "Disposal cost"],
        ...rows.map((r) => [r.vehicle.unitNumber, r.collectedGallons, r.disposedGallons, r.openingLoadGallons, r.closingLoadGallons, r.adjustmentsGallons, r.expectedDisposedGallons, r.discrepancyGallons, r.flagged ? "YES" : "", c(r.costCents)]),
      ]);
    }
    case "disposal-bills": {
      assertStaffActor(actor, "disposal.read");
      const status = ["OPEN", "PAID", "VOID"].includes(sp.status ?? "") ? (sp.status as "OPEN" | "PAID" | "VOID") : undefined;
      const bills = await listDisposalBills({ from, to, facilityId: sp.vendor && /^[0-9a-f-]{36}$/i.test(sp.vendor) ? sp.vendor : undefined, status });
      return csvResponse(`disposal-bills-${stamp}.csv`, [
        ["Vendor", "Invoice #", "Invoice date", "Due date", "Service date", "Reference", "Pay by (plan)", "Status", "Paid on", "Payment ref", "Line", "Waste type", "Gallons", "Rate $/gal", "Line amount", "Manifests", "Bill total"],
        ...bills.flatMap((b) =>
          b.lines.map((l) => [b.facility.name, b.vendorInvoiceNumber, keyFromDate(b.invoiceDate), b.dueDate ? keyFromDate(b.dueDate) : "", b.serviceDate ? keyFromDate(b.serviceDate) : "", b.referenceNumber ?? "", b.scheduledPayDate ? keyFromDate(b.scheduledPayDate) : "", b.status, b.paidAt ? keyFromDate(b.paidAt) : "", b.paymentReference ?? "", l.description, l.wasteType ?? "", l.gallons ?? "", l.ratePerGallonCents ? (Number(l.ratePerGallonCents) / 100).toString() : "", c(l.amountCents), l.manifestNumbers.join(" "), c(b.totalCents)]),
        ),
      ]);
    }
    default:
      throw notFound();
  }
});
