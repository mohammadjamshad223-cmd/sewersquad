import Link from "next/link";
import { Search } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateKey } from "@/lib/dates";

export const metadata = { title: "Search" };

/** Global search across customers, locations, invoices, manifests, jobs, drivers and trucks (permission-aware). */
export default async function GlobalSearch({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const actor = await requireStaffPage();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  if (q.length < 2) return <div><PageHeader title="Search" /><EmptyState icon={Search} title="Type at least 2 characters" /></div>;
  const ci = { contains: q, mode: "insensitive" as const };
  const digits = q.replace(/\D/g, "");
  const can = (p: Parameters<typeof hasPermission>[1]) => hasPermission(actor, p);
  const [orgs, locs, invoices, manifests, jobs, drivers, trucks] = await Promise.all([
    can("customers.read") ? prisma.organization.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { accountNumber: ci }, { primaryEmail: ci }, ...(digits.length >= 4 ? [{ primaryPhone: { contains: digits.slice(-4) } }] : [])] }, take: 8 }) : [],
    can("customers.read") ? prisma.serviceLocation.findMany({ where: { deletedAt: null, OR: [{ name: ci }, { addressLine1: ci }, { code: ci }, { postalCode: { startsWith: q } }, ...(digits.length >= 4 ? [{ siteContactPhone: { contains: digits.slice(-4) } }] : [])] }, include: { organization: { select: { name: true } } }, take: 8 }) : [],
    can("invoices.read") ? prisma.invoice.findMany({ where: { OR: [{ invoiceNumber: ci }, { poNumber: ci }] }, include: { organization: { select: { name: true } } }, take: 8 }) : [],
    can("manifests.read") ? prisma.manifest.findMany({ where: { manifestNumber: ci }, include: { location: { select: { name: true } } }, take: 8 }) : [],
    can("jobs.read") ? prisma.job.findMany({ where: { jobNumber: ci }, include: { location: { select: { name: true } } }, take: 8 }) : [],
    can("fleet.read") ? prisma.driver.findMany({ where: { OR: [{ user: { name: ci } }, { employeeNumber: ci }] }, include: { user: { select: { name: true } } }, take: 8 }) : [],
    can("fleet.read") ? prisma.vehicle.findMany({ where: { OR: [{ unitNumber: ci }, { vin: ci }, { licensePlate: ci }] }, take: 8 }) : [],
  ]);
  const groups: { title: string; rows: { href: string; title: string; sub: string; badge?: React.ReactNode }[] }[] = [
    { title: "Customers", rows: orgs.map((o) => ({ href: `/admin/customers/${o.id}`, title: o.name, sub: `${o.accountNumber} · ${o.primaryPhone ?? ""}` })) },
    { title: "Service locations", rows: locs.map((l) => ({ href: `/admin/locations/${l.id}`, title: l.name, sub: `${l.addressLine1}, ${l.city} · ${l.organization.name}` })) },
    { title: "Invoices", rows: invoices.map((i) => ({ href: `/admin/invoices/${i.id}`, title: i.invoiceNumber, sub: i.organization.name, badge: <StatusBadge kind="invoice" status={i.status} /> })) },
    { title: "Manifests", rows: manifests.map((m) => ({ href: `/admin/manifests/${m.id}`, title: m.manifestNumber, sub: `${m.location.name} · ${formatDateKey(m.serviceDate)}`, badge: <StatusBadge kind="manifest" status={m.status} /> })) },
    { title: "Jobs", rows: jobs.map((j) => ({ href: `/admin/jobs/${j.id}`, title: j.jobNumber, sub: `${j.location.name} · ${formatDateKey(j.scheduledDate)}`, badge: <StatusBadge kind="job" status={j.status} /> })) },
    { title: "Drivers", rows: drivers.map((d) => ({ href: `/admin/drivers/${d.id}`, title: d.user.name, sub: d.employeeNumber })) },
    { title: "Trucks", rows: trucks.map((v) => ({ href: `/admin/fleet/${v.id}`, title: v.unitNumber, sub: [v.licensePlate, v.vin].filter(Boolean).join(" · ") })) },
  ].filter((g) => g.rows.length > 0);
  return (
    <div className="space-y-6">
      <PageHeader title={`Results for “${q}”`} />
      {groups.length === 0 && <EmptyState icon={Search} title="No matches" />}
      {groups.map((g) => (
        <Card key={g.title}>
          <CardHeader title={g.title} />
          <ul className="divide-y">{g.rows.map((r) => <li key={r.href}><Link href={r.href} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-subtle"><span><span className="block text-sm font-medium">{r.title}</span><span className="text-[12px] text-muted-foreground">{r.sub}</span></span>{r.badge}</Link></li>)}</ul>
        </Card>
      ))}
    </div>
  );
}
