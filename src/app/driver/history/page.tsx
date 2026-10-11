import Link from "next/link";
import { History } from "lucide-react";
import { requireDriverPage } from "@/server/authz/guards";
import { driverHistory } from "@/server/services/driver-portal";
import { EmptyState } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { formatDateKey } from "@/lib/dates";

export const metadata = { title: "Service history" };

export default async function DriverHistory({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const actor = await requireDriverPage();
  const page = parsePage((await searchParams).page);
  const { items, total, pageSize } = await driverHistory(actor.driverId, page);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Service history</h1>
      {items.length === 0 && <EmptyState icon={History} title="No completed jobs yet" />}
      <ul className="space-y-2">
        {items.map((j) => (
          <li key={j.id}>
            <Link href={`/driver/jobs/${j.id}`} className="flex items-center justify-between gap-3 rounded-xl border bg-surface p-4 shadow-card">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold">{j.location.name}</p>
                <p className="text-[13px] text-muted-foreground">{formatDateKey(j.scheduledDate)} · {(j.serviceRecord?.assetRecords.reduce((s, a) => s + a.gallonsPumped, 0) ?? 0).toLocaleString()} gal{j.manifest ? ` · ${j.manifest.manifestNumber}` : ""}</p>
              </div>
              <StatusBadge kind="job" status={j.status} />
            </Link>
          </li>
        ))}
      </ul>
      {total > pageSize && <Pagination page={page} pageSize={pageSize} total={total} searchParams={{}} basePath="/driver/history" />}
    </div>
  );
}
