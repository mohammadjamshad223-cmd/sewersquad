import { idParam } from "@/server/params";
import { notFound } from "next/navigation";
import { customerContext } from "@/server/customer-context";
import { customerLocation } from "@/server/services/customer-portal";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { BarSeries } from "@/components/charts/charts";
import { describeRule } from "@/domain/recurrence";
import { formatDateKey, formatInstant, formatWindow } from "@/lib/dates";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { formatAddress } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";

export const metadata = { title: "Location" };

export default async function LocationDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  const { scope } = await customerContext();
  let data;
  try {
    data = await customerLocation(scope, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const { loc, volumes } = data;
  const tz = await companyTimeZone();
  return (
    <div className="space-y-6">
      <PageHeader title={loc.name} description={formatAddress(loc)} breadcrumbs={[{ label: "Locations", href: "/customer/locations" }, { label: loc.name }]} />
      <Card>
        <CardHeader title="Site details" description="To update these details, contact Sewer Squad — changes are verified by our office." />
        <CardBody>
          <DescriptionList
            columns={3}
            items={[
              { label: "Location code", value: loc.code },
              { label: "Site contact", value: [loc.siteContactName, loc.siteContactPhone].filter(Boolean).join(" · ") || "—" },
              { label: "Default service window", value: formatWindow(loc.defaultWindowStart, loc.defaultWindowEnd) },
              { label: "Access instructions", value: loc.accessInstructions },
              { label: "Special requirements", value: loc.specialRequirements },
            ]}
          />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Equipment" />
        <Table>
          <THead><tr><TH>Asset</TH><TH>Type</TH><TH className="text-right">Capacity</TH><TH className="hidden md:table-cell">Placement</TH><TH className="hidden md:table-cell">Installed at</TH><TH>Last serviced</TH></tr></THead>
          <TBody>
            {loc.assets.map((a) => (
              <TR key={a.id}>
                <TD className="font-medium">{a.assetTag}</TD>
                <TD>{a.type === "OTHER" && a.customTypeLabel ? a.customTypeLabel : ASSET_TYPE_LABEL[a.type]}</TD>
                <TD className="text-right tabular-nums">{a.capacityGallons.toLocaleString()} gal</TD>
                <TD className="hidden md:table-cell">{a.placement === "INDOOR" ? "Indoor" : "Outdoor"}</TD>
                <TD className="hidden md:table-cell">{a.installLocation ?? "—"}</TD>
                <TD>{a.lastServicedAt ? formatInstant(a.lastServicedAt, tz, "date") : "—"}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
      <Card>
        <CardHeader title="Service schedule" />
        <CardBody className="space-y-3 text-sm">
          {loc.plans.length === 0 && <p className="text-muted-foreground">No recurring service plan.</p>}
          {loc.plans.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{p.name}</p>
                <p className="text-[13px] text-muted-foreground">{SERVICE_TYPE_LABEL[p.serviceType]} · {describeRule({ unit: p.recurrenceRule.unit, interval: p.recurrenceRule.interval, anchor: p.recurrenceRule.anchor })}</p>
              </div>
              <p className="text-[13px]">{p.status === "ACTIVE" ? `Next service ${formatDateKey(p.nextServiceDate, "long")}` : "Paused"}</p>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Pumping volume" description="Gallons collected per month, last 24 months." />
        <CardBody><BarSeries data={volumes.map((v) => ({ month: new Date(`${v.month}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }), gallons: v.gallons }))} xKey="month" yKey="gallons" format="gallons" seriesName="Gallons pumped" /></CardBody>
      </Card>
    </div>
  );
}
