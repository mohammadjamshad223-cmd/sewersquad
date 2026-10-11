import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatWindow } from "@/lib/dates";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { cn } from "@/lib/utils";

type Stop = {
  id: string;
  status: string;
  priority: string;
  windowStart: string | null;
  windowEnd: string | null;
  serviceType: string;
  estimatedGallons: number | null;
  instructions: string | null;
  location: { name: string; addressLine1: string; city: string; specialRequirements: string | null };
  assets: { asset: { type: string; capacityGallons: number } }[];
};

export function StopCard({ stop, index, highlight }: { stop: Stop; index?: number; highlight?: boolean }) {
  const done = ["SUBMITTED", "COMPLETED"].includes(stop.status);
  return (
    <Link href={`/driver/jobs/${stop.id}`} className={cn("flex items-stretch gap-3 rounded-xl border bg-surface p-4 shadow-card active:bg-subtle", highlight && "border-brand ring-1 ring-brand/30", done && "opacity-70")}>
      {index !== undefined && (
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold", done ? "bg-success-soft text-success" : "bg-brand text-brand-foreground")}>{index}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-[16px] font-semibold">{stop.location.name}</p>
          <StatusBadge kind="job" status={stop.status} />
        </div>
        <p className="truncate text-[14px] text-muted-foreground">{stop.location.addressLine1}, {stop.location.city}</p>
        <p className="mt-1.5 text-[14px]">
          <span className="font-medium">{formatWindow(stop.windowStart, stop.windowEnd)}</span>
          <span className="text-muted-foreground"> · {SERVICE_TYPE_LABEL[stop.serviceType]}</span>
        </p>
        <p className="text-[13px] text-muted-foreground">
          {stop.assets.map((a) => `${ASSET_TYPE_LABEL[a.asset.type]} ${a.asset.capacityGallons.toLocaleString()} gal`).join(" · ") || "No equipment listed"}
          {stop.estimatedGallons ? ` · est. ${stop.estimatedGallons.toLocaleString()} gal` : ""}
        </p>
        {stop.priority === "EMERGENCY" && <p className="mt-1 text-[13px] font-semibold text-danger">EMERGENCY</p>}
        {(stop.instructions || stop.location.specialRequirements) && <p className="mt-1.5 line-clamp-2 rounded-md bg-warning-soft px-2 py-1 text-[13px] text-foreground">{stop.instructions ?? stop.location.specialRequirements}</p>}
      </div>
      <ChevronRight className="h-5 w-5 shrink-0 self-center text-muted-foreground" aria-hidden />
    </Link>
  );
}
