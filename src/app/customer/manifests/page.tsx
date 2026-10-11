import Link from "next/link";
import { ClipboardCheck, Download, FileArchive } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerManifests } from "@/server/services/customer-portal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { SelectAll, SelectionCount } from "@/components/portal/select-table";
import { formatDateKey } from "@/lib/dates";
import { formatGallons } from "@/lib/money";
import { WASTE_TYPES } from "@/lib/status";

export const metadata = { title: "Manifests" };

export default async function Manifests({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { locationIds, selectedLocationId } = await customerContext();
  const { items, total, pageSize } = await customerManifests(locationIds, { page, q: sp.q, from: sp.from, to: sp.to, wasteType: sp.wasteType });
  const exportQs = new URLSearchParams(Object.entries({ q: sp.q, from: sp.from, to: sp.to, wasteType: sp.wasteType, location: selectedLocationId ?? undefined }).filter(([, v]) => v) as [string, string][]);
  return (
    <div>
      <PageHeader
        title="Manifests"
        description="Finalized waste manifests for your locations. Manifests appear here after our office verifies the service documentation."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/api/export/manifests?${exportQs}`}><Download /> Export CSV</a>
          </Button>
        }
      />
      <Card>
        <FilterBar search={{ placeholder: "Manifest or job #" }} dates selects={[{ param: "wasteType", label: "Waste type", options: WASTE_TYPES.map((w) => ({ value: w, label: w })) }]} />
        {items.length === 0 ? (
          <EmptyState icon={ClipboardCheck} title="No manifests found" description="Finalized manifests for completed services will be listed here." />
        ) : (
          <form action="/api/documents/zip" method="post">
            <Table>
              <THead>
                <tr>
                  <TH className="w-10"><SelectAll name="ids" label="Select all manifests" /></TH>
                  <TH>Manifest</TH>
                  <TH>Service date</TH>
                  <TH>Location</TH>
                  <TH className="hidden md:table-cell">Waste type</TH>
                  <TH className="text-right">Gallons</TH>
                  <TH>Driver</TH>
                  <TH className="text-right">Download</TH>
                </tr>
              </THead>
              <TBody>
                {items.map((m) => {
                  const pdf = m.documents.find((d) => d.type === "MANIFEST");
                  const official = m.documents.find((d) => d.type === "MANIFEST_OFFICIAL");
                  return (
                    <TR key={m.id}>
                      <TD>{pdf && <input type="checkbox" name="ids" value={pdf.id} aria-label={`Select ${m.manifestNumber}`} className="h-4 w-4 accent-[hsl(var(--brand))]" />}</TD>
                      <TD className="whitespace-nowrap font-medium">{m.manifestNumber}<Link href={`/customer/services/${m.job.id}`} className="block text-[12px] font-normal text-muted-foreground hover:text-brand">{m.job.jobNumber}</Link></TD>
                      <TD className="whitespace-nowrap">{formatDateKey(m.serviceDate)}</TD>
                      <TD>{m.location.name}</TD>
                      <TD className="hidden md:table-cell">{m.wasteType ?? "—"}</TD>
                      <TD className="text-right tabular-nums">{formatGallons(m.totalGallons)}</TD>
                      <TD>{m.driverName ?? "—"}</TD>
                      <TD className="whitespace-nowrap text-right">
                        {pdf && <DocLink id={pdf.id}>PDF</DocLink>}
                        {official && <DocLink id={official.id} className="ml-3">Official</DocLink>}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <div className="flex items-center justify-between gap-3 border-t px-4 py-3">
              <SelectionCount name="ids" />
              <Button type="submit" variant="secondary" size="sm"><FileArchive /> Download selected (ZIP)</Button>
            </div>
          </form>
        )}
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/customer/manifests" />}
      </Card>
    </div>
  );
}
