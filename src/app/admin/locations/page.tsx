import Link from "next/link";
import { MapPin } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { formatDateKey } from "@/lib/dates";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Service locations" };

export default async function Locations({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaffPage("customers.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const territories = await prisma.serviceLocation.findMany({ where: { territory: { not: null } }, distinct: ["territory"], select: { territory: true } });
  const where: Prisma.ServiceLocationWhereInput = {
    deletedAt: null,
    ...(sp.status ? { status: sp.status as "ACTIVE" | "INACTIVE" } : {}),
    ...(sp.territory ? { territory: sp.territory } : {}),
    ...(sp.q ? { OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { addressLine1: { contains: sp.q, mode: "insensitive" } }, { city: { contains: sp.q, mode: "insensitive" } }, { postalCode: { startsWith: sp.q } }, { code: { contains: sp.q, mode: "insensitive" } }, { siteContactPhone: { contains: sp.q } }, { organization: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.serviceLocation.findMany({ where, include: { organization: { select: { id: true, name: true } }, _count: { select: { assets: { where: { deletedAt: null } } } }, plans: { where: { status: "ACTIVE" }, select: { nextServiceDate: true }, orderBy: { nextServiceDate: "asc" }, take: 1 } }, orderBy: { name: "asc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.serviceLocation.count({ where }),
  ]);
  return (
    <div>
      <PageHeader title="Service locations" description="Every physical site across all customers." />
      <Card>
        <FilterBar search={{ placeholder: "Name, address, ZIP, phone, customer…" }} selects={[{ param: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] }, { param: "territory", label: "Territory", options: territories.map((t) => ({ value: t.territory!, label: t.territory! })) }]} />
        {items.length === 0 ? <EmptyState icon={MapPin} title="No locations found" /> : (
          <Table>
            <THead><tr><TH>Location</TH><TH>Customer</TH><TH className="hidden md:table-cell">Address</TH><TH className="hidden lg:table-cell">Territory</TH><TH className="text-right">Equipment</TH><TH>Next service</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((l) => (
                <TR key={l.id}>
                  <TD><Link href={`/admin/locations/${l.id}`} className="font-medium hover:text-brand">{l.name}</Link><span className="block font-mono text-[12px] text-muted-foreground">{l.code}</span></TD>
                  <TD><Link href={`/admin/customers/${l.organization.id}`} className="hover:text-brand">{l.organization.name}</Link></TD>
                  <TD className="hidden md:table-cell text-[13px]">{l.addressLine1}, {l.city} {l.postalCode}</TD>
                  <TD className="hidden lg:table-cell">{l.territory ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{l._count.assets}</TD>
                  <TD className="whitespace-nowrap">{l.plans[0]?.nextServiceDate ? formatDateKey(l.plans[0].nextServiceDate) : "—"}</TD>
                  <TD><Badge tone={l.status === "ACTIVE" ? "success" : "neutral"} dot>{titleCase(l.status)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={25} total={total} searchParams={sp} basePath="/admin/locations" />
      </Card>
    </div>
  );
}
