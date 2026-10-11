import Link from "next/link";
import { CalendarClock } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerUpcoming, isRescheduled } from "@/server/services/customer-portal";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { CustomerJobBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { formatDateKey, formatWindow } from "@/lib/dates";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";

export const metadata = { title: "Upcoming services" };

export default async function UpcomingServices({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { locationIds, access } = await customerContext();
  const { items, total, pageSize } = await customerUpcoming(locationIds, page);
  return (
    <div>
      <PageHeader title="Upcoming services" description="Scheduled visits for your locations. Need a different date? Request a change and our dispatch team will confirm." />
      <Card>
        {items.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No upcoming services" description="Recurring visits appear here once they're scheduled." />
        ) : (
          <Table>
            <THead>
              <tr>
                <TH>Date</TH>
                <TH>Location</TH>
                <TH className="hidden md:table-cell">Service</TH>
                <TH className="hidden lg:table-cell">Equipment</TH>
                <TH>Window</TH>
                <TH>Status</TH>
                <TH className="text-right"><span className="sr-only">Actions</span></TH>
              </tr>
            </THead>
            <TBody>
              {items.map((j) => (
                <TR key={j.id}>
                  <TD className="whitespace-nowrap font-medium">{formatDateKey(j.scheduledDate, "weekday")}</TD>
                  <TD>{j.location.name}</TD>
                  <TD className="hidden md:table-cell">{SERVICE_TYPE_LABEL[j.serviceType]}</TD>
                  <TD className="hidden lg:table-cell text-[13px]">
                    {j.assets.map((a) => `${ASSET_TYPE_LABEL[a.asset.type]} · ${a.asset.capacityGallons.toLocaleString()} gal`).join(", ") || "—"}
                  </TD>
                  <TD className="whitespace-nowrap text-[13px]">{formatWindow(j.windowStart, j.windowEnd)}</TD>
                  <TD><CustomerJobBadge status={j.status} confirmedByOffice={j.confirmedByOffice} rescheduled={isRescheduled(j)} /></TD>
                  <TD className="whitespace-nowrap text-right text-[13px]">
                    <Link href={`/customer/services/${j.id}`} className="font-medium text-brand hover:underline">Details</Link>
                    {access.allowRescheduleRequests && ["SCHEDULED", "ASSIGNED", "ACCEPTED"].includes(j.status) && (
                      <Link href={`/customer/support/new?category=RESCHEDULE&jobId=${j.id}`} className="ml-4 text-muted-foreground hover:text-foreground">Request change</Link>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/customer/services" />}
      </Card>
    </div>
  );
}
