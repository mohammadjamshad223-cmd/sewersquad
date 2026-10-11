"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { selectLocationAction } from "@/app/customer/actions";

export function LocationSwitcher({
  locations,
  selectedId,
  orgName,
  allowAll,
}: {
  locations: { id: string; name: string; city: string }[];
  selectedId: string | null;
  orgName: string;
  allowAll: boolean;
}) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  if (locations.length <= 1) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate font-medium">{locations[0]?.name ?? orgName}</span>
      </div>
    );
  }
  return (
    <label className="flex min-w-0 items-center gap-2">
      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="sr-only">Location</span>
      <select
        className="h-9 min-w-0 max-w-[280px] truncate rounded-md border border-input bg-surface px-2 text-sm font-medium disabled:opacity-60"
        value={selectedId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const v = e.target.value || null;
          start(async () => {
            const res = await selectLocationAction(v);
            if (!res.ok) toast.error(res.error);
            router.refresh();
          });
        }}
      >
        {allowAll && <option value="">All locations ({locations.length})</option>}
        {locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name} · {l.city}
          </option>
        ))}
      </select>
    </label>
  );
}
