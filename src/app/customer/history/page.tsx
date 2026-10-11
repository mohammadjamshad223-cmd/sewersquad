import Link from "next/link";
import { Download, History } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerHistory } from "@/server/services/customer-portal";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { CustomerJobBadge, StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { formatDateKey } from "@/lib/dates";
import { formatGallons } from "@/lib/money";
import { SERVICE_TYPE_LABEL } from "@/lib/status";

export const metadata = { title: "Service history" };

export default async function ServiceHistory({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { locationIds, access, selectedLocationId } = await customerContext();
  const { items, total, pageSize } = await customerHistory(locationIds, { page, from: sp.from, to: sp.to, q: sp.q });
  const exportQs = new URLSearchParams({ ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}), ...(selectedLocationId ? { location: selectedLocationId } : {}) });
  return (
    <div>
      <PageHeader
        title="Service history"
        description="Completed visits with gallons pumped, manifests and invoices."
        actions={
          <Button asChild variant="secondary" size="sm">
            <a href={`/api/export/service-history?${exportQs}`}><Download /> Export CSV</a>
          </Button>
        }
      />
      <Card>
        <FilterBar search={{ placeholder: "Search job or manifest #" }} dates />
        {items.length === 0 ? (
          <EmptyState icon={History} title="No services found" description="Try a different date range or location." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Location</TH>
                <TH className="hidden md:table-cell">Service</TH>
                <TH className="text-right">Gallons</TH>
                {access.showDriverNames && <TH className="hidden lg:table-cell">Technician</TH>}
                <TH>Status</TH>
                <TH>Manifest</TH>
                <TH>Invoice</TH>
              </tr>
            </THead>
            <TBody>
              {items.map((j) => (
                <TR key={j.id}>
                  <TD className="whitespace-nowrap">
                    <Link href={`/customer/services/${j.id}`} className="font-medium hover:text-brand">{formatDateKey(j.scheduledDate)}</Link>
                    <span className="block text-[12px] text-muted-foreground">{j.jobNumber}</span>
                  </TD>
                  <TD>{j.location.name}</TD>
                  <TD className="hidden md:table-cell">{SERVICE_TYPE_LABEL[j.serviceType]}</TD>
                  <TD className="text-right tabular-nums">{j.serviceRecord ? formatGallons(j.serviceRecord.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0)) : "—"}</TD>
                  {access.showDriverNames && <TD className="hidden lg:table-cell">{j.driver?.user.name ?? "—"}</TD>}
                  <TD><CustomerJobBadge status={j.status} /></TD>
                  <TD>{j.manifest?.documents[0] ? <DocLink id={j.manifest.documents[0].id}>{j.manifest.manifestNumber}</DocLink> : <span className="text-[12px] text-muted-foreground">{j.manifest ? "In review" : "—"}</span>}</TD>
                  <TD>
                    {j.invoices[0] ? (
                      <Link href={`/customer/invoices/${j.invoices[0].id}`} className="inline-flex items-center gap-2 text-[13px] font-medium text-brand hover:underline">
                        {j.invoices[0].invoiceNumber} <StatusBadge kind="invoice" status={j.invoices[0].status} />
                      </Link>
                    ) : "—"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/customer/history" />}
      </Card>
    </div>
  );
}
