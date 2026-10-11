import Link from "next/link";
import { ClipboardCheck, Download, FileArchive } from "lucide-react";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { manifestListWhere } from "@/server/services/manifests";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { SelectAll, SelectionCount } from "@/components/portal/select-table";
import { formatDateKey } from "@/lib/dates";
import { formatGallons } from "@/lib/money";
import { MANIFEST_STATUS, WASTE_TYPES } from "@/lib/status";

export const metadata = { title: "Manifests" };

export default async function Manifests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireStaffPage("manifests.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const orgs = await prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const where = manifestListWhere({ q: sp.q, status: sp.status, from: sp.from, to: sp.to, wasteType: sp.wasteType, driver: sp.driver, organizationId: sp.org });
  const [items, total] = await Promise.all([
    prisma.manifest.findMany({ where, include: { organization: { select: { name: true } }, location: { select: { name: true } }, job: { select: { id: true, jobNumber: true } }, documents: { where: { type: { in: ["MANIFEST", "MANIFEST_OFFICIAL"] }, deletedAt: null }, select: { id: true, type: true, visibility: true }, orderBy: { createdAt: "desc" } } }, orderBy: { serviceDate: "desc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.manifest.count({ where }),
  ]);
  const qs = new URLSearchParams(Object.entries({ q: sp.q, status: sp.status, from: sp.from, to: sp.to, wasteType: sp.wasteType, driver: sp.driver, organizationId: sp.org }).filter(([, v]) => v) as [string, string][]);
  return (
    <div>
      <PageHeader title="Manifests" description="Create, review, finalize and retrieve waste manifests." actions={<Button asChild variant="secondary" size="sm"><a href={`/api/export/manifests?${qs}`}><Download /> Export CSV</a></Button>} />
      <Card>
        <FilterBar
          search={{ placeholder: "Manifest #, job #, customer, location" }}
          dates
          selects={[
            { param: "status", label: "Status", options: Object.entries(MANIFEST_STATUS).map(([value, m]) => ({ value, label: m.label })) },
            { param: "wasteType", label: "Waste", options: WASTE_TYPES.map((w) => ({ value: w, label: w })) },
            { param: "org", label: "Customer", options: orgs.map((o) => ({ value: o.id, label: o.name })) },
          ]}
        />
        {items.length === 0 ? <EmptyState icon={ClipboardCheck} title="No manifests found" /> : (
          <form action="/api/documents/zip" method="post">
            <Table>
              <THead><tr><TH className="w-10"><SelectAll name="ids" /></TH><TH>Manifest</TH><TH>Service date</TH><TH>Customer / location</TH><TH className="hidden lg:table-cell">Waste</TH><TH className="text-right">Gallons</TH><TH className="hidden md:table-cell">Driver</TH><TH className="text-right">Ver.</TH><TH>Status</TH></tr></THead>
              <TBody>
                {items.map((m) => {
                  const pdf = m.documents.find((d) => d.type === "MANIFEST");
                  return (
                    <TR key={m.id}>
                      <TD>{pdf && <input type="checkbox" name="ids" value={pdf.id} aria-label={`Select ${m.manifestNumber}`} className="h-4 w-4 accent-[hsl(var(--brand))]" />}</TD>
                      <TD className="whitespace-nowrap"><Link href={`/admin/manifests/${m.id}`} className="font-medium hover:text-brand">{m.manifestNumber}</Link><Link href={`/admin/jobs/${m.job.id}`} className="block text-[12px] text-muted-foreground hover:text-brand">{m.job.jobNumber}</Link></TD>
                      <TD className="whitespace-nowrap">{formatDateKey(m.serviceDate)}</TD>
                      <TD>{m.location.name}<span className="block text-[12px] text-muted-foreground">{m.organization.name}</span></TD>
                      <TD className="hidden lg:table-cell">{m.wasteType ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{formatGallons(m.totalGallons)}</TD>
                      <TD className="hidden md:table-cell">{m.driverName ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{m.currentVersion}</TD>
                      <TD><StatusBadge kind="manifest" status={m.status} /></TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-3"><SelectionCount name="ids" /><Button type="submit" variant="secondary" size="sm"><FileArchive /> Download selected PDFs (ZIP)</Button></div>
          </form>
        )}
        <Pagination page={page} pageSize={25} total={total} searchParams={sp} basePath="/admin/manifests" />
      </Card>
    </div>
  );
}
