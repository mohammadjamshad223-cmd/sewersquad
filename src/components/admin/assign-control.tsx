"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Select } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { assignJobAction } from "@/app/admin/_actions/ops";

/** Driver + truck assignment (keyboard-accessible alternative to drag-and-drop). */
export function AssignControl({ jobId, driverId, vehicleId, drivers, vehicles, disabled }: { jobId: string; driverId: string | null; vehicleId: string | null; drivers: { id: string; name: string; vehicleId: string | null }[]; vehicles: { id: string; unitNumber: string; unavailable?: boolean }[]; disabled?: boolean }) {
  const router = useRouter();
  const [d, setD] = React.useState(driverId ?? "");
  const [v, setV] = React.useState(vehicleId ?? "");
  const [pending, start] = React.useTransition();
  const dirty = d !== (driverId ?? "") || v !== (vehicleId ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Driver" className="w-auto min-w-[160px]" value={d} disabled={disabled || pending} onChange={(e) => { setD(e.target.value); const def = drivers.find((x) => x.id === e.target.value)?.vehicleId; if (def) setV(def); }}>
        <option value="">Unassigned</option>
        {drivers.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </Select>
      <Select aria-label="Truck" className="w-auto min-w-[110px]" value={v} disabled={disabled || pending || !d} onChange={(e) => setV(e.target.value)}>
        <option value="">No truck</option>
        {vehicles.map((x) => <option key={x.id} value={x.id} disabled={x.unavailable}>{x.unitNumber}{x.unavailable ? " (unavailable)" : ""}</option>)}
      </Select>
      {dirty && (
        <Button size="sm" disabled={pending} onClick={() => start(async () => {
          const res = await assignJobAction(jobId, d || null, d ? v || null : null);
          if (res.ok) { toast.success(d ? "Assigned — driver notified." : "Unassigned."); router.refresh(); } else toast.error(res.error);
        })}>{pending && <Loader2 className="animate-spin" />} Save</Button>
      )}
    </div>
  );
}
