"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, ClipboardEdit, Loader2, MapPin, Navigation, Phone, PlayCircle, Truck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { jobTransitionAction } from "@/app/driver/actions";

type To = "ACCEPTED" | "EN_ROUTE" | "ARRIVED" | "IN_PROGRESS" | "UNABLE_TO_SERVICE";

function position(): Promise<{ latitude: number; longitude: number } | null> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }), () => resolve(null), { timeout: 4000, maximumAge: 60_000 }));
}

/** Large, single-tap status controls for field use. */
export function JobActions({ jobId, status, address, phone, compact = false }: { jobId: string; status: string; address: string; phone?: string | null; compact?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = React.useState<To | null>(null);
  const [unableOpen, setUnableOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const go = async (to: To, extra: { note?: string } = {}) => {
    setPending(to);
    const pos = to === "ARRIVED" ? await position() : null;
    const res = await jobTransitionAction(jobId, to, { ...extra, latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null });
    setPending(null);
    if (res.ok) {
      toast.success(to === "EN_ROUTE" ? "Marked en route — customer notified." : to === "ARRIVED" ? "Arrival recorded." : to === "UNABLE_TO_SERVICE" ? "Reported to dispatch." : "Updated.");
      setUnableOpen(false);
      if (to === "ARRIVED") router.push(`/driver/jobs/${jobId}/complete`);
      else router.refresh();
    } else toast.error(res.error);
  };
  const spin = (to: To) => (pending === to ? <Loader2 className="animate-spin" /> : null);
  const size = compact ? "lg" : "xl";
  const q = encodeURIComponent(address);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <Button asChild variant="secondary" size={size}>
          <a href={`https://www.google.com/maps/dir/?api=1&destination=${q}`} target="_blank" rel="noopener"><Navigation /> Google Maps</a>
        </Button>
        <Button asChild variant="secondary" size={size}>
          <a href={`https://maps.apple.com/?daddr=${q}`} target="_blank" rel="noopener"><MapPin /> Apple Maps</a>
        </Button>
      </div>
      {phone && (
        <Button asChild variant="secondary" size={size} className="w-full">
          <a href={`tel:${phone.replace(/[^\d+]/g, "")}`}><Phone /> Call site contact</a>
        </Button>
      )}
      {(status === "ASSIGNED" || status === "ACCEPTED") && (
        <div className="grid grid-cols-2 gap-2">
          {status === "ASSIGNED" && <Button variant="secondary" size={size} disabled={!!pending} onClick={() => go("ACCEPTED")}>{spin("ACCEPTED") ?? <CheckCircle2 />} Accept</Button>}
          <Button size={size} className={status === "ACCEPTED" ? "col-span-2" : ""} disabled={!!pending} onClick={() => go("EN_ROUTE")}>{spin("EN_ROUTE") ?? <Truck />} Start — en route</Button>
        </div>
      )}
      {status === "EN_ROUTE" && <Button size={size} className="w-full" disabled={!!pending} onClick={() => go("ARRIVED")}>{spin("ARRIVED") ?? <MapPin />} I&apos;ve arrived</Button>}
      {["ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"].includes(status) && (
        <Button asChild size={size} className="w-full"><Link href={`/driver/jobs/${jobId}/complete`}>{status === "ARRIVED" ? <PlayCircle /> : <ClipboardEdit />} {status === "ARRIVED" ? "Start service" : "Continue documentation"}</Link></Button>
      )}
      {["ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS"].includes(status) && (
        <Button variant="ghost" size="lg" className="w-full text-danger" onClick={() => setUnableOpen(true)}><XCircle /> Unable to service</Button>
      )}
      <Dialog open={unableOpen} onOpenChange={setUnableOpen}>
        <DialogContent title="Unable to service" description="Dispatch will be notified to reschedule.">
          <label className="text-[13px] font-medium" htmlFor="unable-note">What happened?</label>
          <Textarea id="unable-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Gate locked, no one on site; vehicle blocking the interceptor lid" className="mt-1.5" />
          <Button variant="danger" size="lg" className="mt-4 w-full" disabled={note.trim().length < 5 || !!pending} onClick={() => go("UNABLE_TO_SERVICE", { note })}>{spin("UNABLE_TO_SERVICE")} Report to dispatch</Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
