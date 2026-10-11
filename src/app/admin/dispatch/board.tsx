"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Select } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assignJobAction, moveJobAction, reorderRouteAction } from "@/app/admin/_actions/ops";

export type BoardJob = { id: string; jobNumber: string; status: string; priority: string; location: string; city: string; window: string; estimatedGallons: number | null; driverId: string | null; vehicleId: string | null; routeOrder: number | null };
export type BoardColumn = { id: string; title: string; subtitle: string; kind: "unassigned" | "driver" | "truck"; driverId: string | null; vehicleId: string | null; capacity: number | null; jobs: BoardJob[]; warnings: string[]; load: number };

const MOVABLE = ["SCHEDULED", "ASSIGNED", "ACCEPTED"];

/**
 * Dispatch board. Drag a card to another column to (re)assign, or use the per-card controls
 * (keyboard accessible): driver select, move up/down to reorder, date field to move days.
 */
export function DispatchBoard({ date, columns, drivers }: { date: string; columns: BoardColumn[]; drivers: { id: string; name: string; vehicleId: string | null }[] }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [over, setOver] = React.useState<string | null>(null);

  const assign = (job: BoardJob, col: BoardColumn) =>
    start(async () => {
      const driverId = col.kind === "driver" ? col.driverId : col.kind === "truck" ? job.driverId ?? drivers.find((d) => d.vehicleId === col.vehicleId)?.id ?? null : null;
      if (col.kind === "truck" && !driverId) return void toast.error("Assign a driver first, then move the job to a truck.");
      const vehicleId = col.kind === "truck" ? col.vehicleId : col.kind === "driver" ? drivers.find((d) => d.id === col.driverId)?.vehicleId ?? job.vehicleId : null;
      const res = await assignJobAction(job.id, driverId, driverId ? vehicleId : null);
      if (res.ok) {
        toast.success(driverId ? `${job.jobNumber} assigned.` : `${job.jobNumber} unassigned.`);
        router.refresh();
      } else toast.error(res.error);
    });

  const reorder = (col: BoardColumn, idx: number, dir: -1 | 1) =>
    start(async () => {
      if (!col.driverId) return;
      const ids = col.jobs.map((j) => j.id);
      const j = idx + dir;
      if (j < 0 || j >= ids.length) return;
      [ids[idx], ids[j]] = [ids[j]!, ids[idx]!];
      const res = await reorderRouteAction(col.driverId, date, ids);
      if (res.ok) router.refresh();
      else toast.error(res.error);
    });

  const move = (job: BoardJob, newDate: string) =>
    start(async () => {
      const res = await moveJobAction(job.id, newDate);
      if (res.ok) {
        toast.success(`${job.jobNumber} moved to ${newDate}.`);
        router.refresh();
      } else toast.error(res.error);
    });

  return (
    <div className={cn("flex gap-4 overflow-x-auto pb-4", pending && "opacity-70")} aria-busy={pending}>
      {columns.map((col) => (
        <section
          key={col.id}
          aria-label={col.title}
          onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
          onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            setOver(null);
            const id = e.dataTransfer.getData("text/job");
            const job = columns.flatMap((c) => c.jobs).find((j) => j.id === id);
            if (job && !col.jobs.some((j) => j.id === id)) assign(job, col);
          }}
          className={cn("flex w-72 shrink-0 flex-col rounded-lg border bg-subtle/60", over === col.id && "border-brand ring-2 ring-brand/30")}
        >
          <header className="border-b bg-surface px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="truncate text-sm font-semibold">{col.title}</p>
              <Badge>{col.jobs.length}</Badge>
            </div>
            <p className="truncate text-[12px] text-muted-foreground">{col.subtitle}</p>
            {col.capacity && (
              <div className="mt-2">
                <div className="flex justify-between text-[11px] text-muted-foreground"><span>Est. load {col.load.toLocaleString()} gal</span><span>{col.capacity.toLocaleString()} tank</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-border"><div className={cn("h-1.5 rounded-full", col.load > col.capacity ? "bg-danger" : "bg-[#2a78d6]")} style={{ width: `${Math.min(100, (col.load / col.capacity) * 100)}%` }} /></div>
              </div>
            )}
            {col.warnings.map((w) => <p key={w} className="mt-2 flex gap-1.5 text-[12px] text-warning"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{w}</p>)}
          </header>
          <ol className="flex-1 space-y-2 p-2">
            {col.jobs.length === 0 && <li className="rounded-md border border-dashed px-3 py-6 text-center text-[12px] text-muted-foreground">Drop jobs here</li>}
            {col.jobs.map((j, idx) => {
              const movable = MOVABLE.includes(j.status);
              return (
                <li
                  key={j.id}
                  draggable={movable}
                  onDragStart={(e) => e.dataTransfer.setData("text/job", j.id)}
                  className={cn("rounded-md border bg-surface p-2.5 shadow-card", j.priority === "EMERGENCY" && "border-danger/40", movable && "cursor-grab")}
                >
                  <div className="flex items-start gap-2">
                    {movable && <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <Link href={`/admin/jobs/${j.id}`} className="truncate text-[13px] font-semibold hover:text-brand">{col.kind === "driver" ? `${idx + 1}. ` : ""}{j.location}</Link>
                        {j.priority === "EMERGENCY" && <Badge tone="danger">ER</Badge>}
                      </div>
                      <p className="truncate text-[12px] text-muted-foreground">{j.city} · {j.window}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <StatusBadge kind="job" status={j.status} />
                        <span className="text-[11px] tabular-nums text-muted-foreground">{j.estimatedGallons ? `${j.estimatedGallons.toLocaleString()} gal` : "no est."}</span>
                      </div>
                      {movable && (
                        <div className="mt-2 flex items-center gap-1 border-t pt-2">
                          <Select aria-label={`Driver for ${j.jobNumber}`} className="h-7 flex-1 px-1.5 text-[12px]" value={j.driverId ?? ""} disabled={pending} onChange={(e) => assign(j, { ...col, kind: e.target.value ? "driver" : "unassigned", driverId: e.target.value || null })}>
                            <option value="">Unassigned</option>
                            {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </Select>
                          {col.kind === "driver" && (
                            <>
                              <button type="button" aria-label="Move earlier in route" disabled={idx === 0 || pending} onClick={() => reorder(col, idx, -1)} className="rounded p-1 hover:bg-subtle disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                              <button type="button" aria-label="Move later in route" disabled={idx === col.jobs.length - 1 || pending} onClick={() => reorder(col, idx, 1)} className="rounded p-1 hover:bg-subtle disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                            </>
                          )}
                          <input type="date" aria-label={`Move ${j.jobNumber} to date`} defaultValue={date} disabled={pending} onChange={(e) => e.target.value && e.target.value !== date && move(j, e.target.value)} className="h-7 w-[118px] rounded border border-input bg-surface px-1 text-[11px]" />
                        </div>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
