import Link from "next/link";
import { MapPin } from "lucide-react";
import { customerContext } from "@/server/customer-context";
import { customerLocations, volumesByLocation } from "@/server/services/customer-portal";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/misc";
import { RankedBars } from "@/components/charts/charts";
import { addDays, formatDateKey, todayKey } from "@/lib/dates";
import { describeRule } from "@/domain/recurrence";
import { ASSET_TYPE_LABEL } from "@/lib/status";
import { formatAddress } from "@/lib/utils";

export const metadata = { title: "Locations" };

export default async function Locations() {
  const { scope } = await customerContext();
  const [locations, volumes] = await Promise.all([customerLocations(scope), volumesByLocation(scope.locationIds, addDays(todayKey(), -365))]);
  return (
    <div className="space-y-6">
      <PageHeader title="Locations" description={`${locations.length} service location${locations.length === 1 ? "" : "s"} on your account.`} />
      {locations.length > 1 && (
        <Card>
          <CardHeader title="Pumping volume by location" description="Gallons collected over the last 12 months." />
          <CardBody><RankedBars rows={volumes.map((v) => ({ name: v.name, value: v.gallons }))} format="gallons" /></CardBody>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {locations.map((l) => (
          <Card key={l.id}>
            <CardHeader title={<Link href={`/customer/locations/${l.id}`} className="hover:text-brand">{l.name}</Link>} description={formatAddress(l)} action={<Badge tone={l.status === "ACTIVE" ? "success" : "neutral"}>{l.status.toLowerCase()}</Badge>} />
            <CardBody className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                {l.assets.map((a) => <Badge key={a.id} tone="brand">{ASSET_TYPE_LABEL[a.type]} · {a.capacityGallons.toLocaleString()} gal</Badge>)}
              </div>
              {l.plans.map((p) => (
                <p key={p.id} className="text-[13px] text-muted-foreground">
                  {describeRule({ unit: p.recurrenceRule.unit, interval: p.recurrenceRule.interval, anchor: p.recurrenceRule.anchor })} · next {formatDateKey(p.nextServiceDate)}
                </p>
              ))}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[13px] text-muted-foreground"><MapPin className="mr-1 inline h-3.5 w-3.5" />{l._count.jobs} completed services</span>
                <Link href={`/customer/locations/${l.id}`} className="text-[13px] font-medium text-brand hover:underline">Details</Link>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  );
}
