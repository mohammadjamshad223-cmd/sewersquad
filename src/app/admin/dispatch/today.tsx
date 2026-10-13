"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Camera, CheckCircle2, ChevronDown, MapPin, MessageSquare, Navigation, Phone, Repeat, Siren, Truck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/driver/signature-pad";
import { StopsMap } from "@/components/maps/stops-map";
import { AutoGeocode } from "@/components/maps/auto-geocode";
import { compressImage } from "@/lib/offline-store";
import { cn } from "@/lib/utils";
import { completeJobAction, resendCompletionAction } from "@/app/admin/_actions/dispatch";
import { moveJobAction } from "@/app/admin/_actions/ops";

export type BoardStop = {
  id: string;
  jobNumber: string;
  status: string;
  emergency: boolean;
  recurring: boolean;
  service: string;
  serviceType: string;
  dueKey: string;
  dueLabel: string;
  daysOverdue: number;
  scheduledKey: string;
  window: string | null;
  customer: string;
  location: string;
  locationId: string;
  address: string;
  lat: number | null;
  lng: number | null;
  access: string | null;
  estimatedGallons: number | null;
  cityManifest: boolean;
  contacts: { name: string; phone: string }[];
  assets: { id: string; label: string; capacity: number }[];
  invoice: string | null;
};

const tel = (p: string) => p.replace(/[^\d+]/g, "");
const directions = (address: string) => `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}&travelmode=driving`;

/** Google Maps directions through the stops in list order, starting from wherever the phone is. */
function routeUrl(stops: BoardStop[]) {
  const legs = stops.slice(0, 10).map((s) => s.address);
  if (!legs.length) return null;
  const dest = legs.at(-1)!;
  const waypoints = legs.slice(0, -1);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}${waypoints.length ? `&waypoints=${encodeURIComponent(waypoints.join("|"))}` : ""}&travelmode=driving`;
}

function DueBadge({ s }: { s: BoardStop }) {
  if (s.status === "SUBMITTED") return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[12px] font-semibold text-brand">Needs approval</span>;
  if (s.daysOverdue > 0)
    return <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", s.daysOverdue >= 14 ? "bg-danger text-white" : "bg-danger-soft text-danger")}>{s.daysOverdue} day{s.daysOverdue > 1 ? "s" : ""} overdue</span>;
  return <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent-strong">Due today</span>;
}

export function DispatchToday({ today, todo, upcoming, done, truck, canComplete, canReschedule, mapsConfigured }: { today: string; todo: BoardStop[]; upcoming: BoardStop[]; done: BoardStop[]; truck: { name: string; capacity: number }; canComplete: boolean; canReschedule: boolean; mapsConfigured: boolean }) {
  const [completing, setCompleting] = React.useState<BoardStop | null>(null);
  const load = todo.reduce((s, j) => s + (j.estimatedGallons ?? 0), 0);
  const overdue = todo.filter((s) => s.daysOverdue > 0).length;
  const mapped = todo.filter((s) => s.lat !== null && s.lng !== null);
  const missing = [...new Map(todo.filter((s) => s.lat === null || s.lng === null).map((s) => [s.locationId, { id: s.locationId, name: s.location, address: s.address }])).values()];
  const route = routeUrl(todo);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
      <div className="min-w-0 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <Tile label="To service" value={todo.length} />
          <Tile label="Overdue" value={overdue} tone={overdue ? "danger" : undefined} />
          <Tile label="Done today" value={done.length} tone={done.length ? "good" : undefined} />
        </div>

        <section aria-labelledby="todo-h">
          <h2 id="todo-h" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Today&apos;s list · most overdue first</h2>
          {todo.length === 0 ? (
            <div className="rounded-xl border border-dashed bg-surface px-4 py-10 text-center text-[14px] text-muted-foreground">Nothing due today. Coming-up jobs are below.</div>
          ) : (
            <ol className="space-y-3">
              {todo.map((s, i) => <StopCard key={s.id} s={s} n={i + 1} canComplete={canComplete} canReschedule={canReschedule} today={today} onComplete={() => setCompleting(s)} />)}
            </ol>
          )}
        </section>

        {done.length > 0 && (
          <section aria-labelledby="done-h">
            <h2 id="done-h" className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">Completed today</h2>
            <ul className="divide-y rounded-xl border bg-surface">
              {done.map((s) => <DoneRow key={s.id} s={s} canResend={canComplete} />)}
            </ul>
          </section>
        )}

        {upcoming.length > 0 && (
          <details className="group rounded-xl border bg-surface">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[14px] font-semibold">
              <span>Coming up — next 14 days <span className="ml-1 font-normal text-muted-foreground">({upcoming.length})</span></span>
              <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <ul className="divide-y border-t">
              {upcoming.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
                  <div className="min-w-0">
                    <Link href={`/admin/jobs/${s.id}`} className="block truncate font-medium hover:text-brand">{s.location}</Link>
                    <p className="truncate text-[12px] text-muted-foreground">{s.service} · {s.address}</p>
                  </div>
                  <span className="shrink-0 text-[13px] font-medium tabular-nums">{s.dueLabel}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        <div className="rounded-xl border bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-2 text-[14px] font-semibold"><Truck className="h-4 w-4 text-brand" />{truck.name}</p>
            <p className="text-[13px] tabular-nums text-muted-foreground">{load.toLocaleString()} / {truck.capacity.toLocaleString()} gal est.</p>
          </div>
          <div className="mt-2 h-2 rounded-full bg-border"><div className={cn("h-2 rounded-full", load > truck.capacity ? "bg-danger" : "bg-brand")} style={{ width: `${Math.min(100, (load / truck.capacity) * 100)}%` }} /></div>
          {load > truck.capacity && <p className="mt-2 flex gap-1.5 text-[12px] text-danger"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />More than one tank today — plan a disposal stop after about {truck.capacity.toLocaleString()} gal.</p>}
          {route && <Button asChild className="mt-3 w-full"><a href={route} target="_blank" rel="noreferrer"><Navigation /> Start route in Google Maps</a></Button>}
          {todo.length > 10 && <p className="mt-1.5 text-[12px] text-muted-foreground">Google Maps takes the first 10 stops at a time.</p>}
        </div>
        <div className="rounded-xl border bg-surface p-3">
          {mapsConfigured ? (
            <>
              <AutoGeocode items={missing} />
              <StopsMap route label="Map of today's stops in order" height={360} points={mapped.map((s) => ({ id: s.id, lat: s.lat!, lng: s.lng!, label: String(todo.indexOf(s) + 1), title: s.location, subtitle: `${s.service} · ${s.daysOverdue ? `${s.daysOverdue}d overdue` : "due today"}`, color: s.emergency || s.daysOverdue >= 14 ? "#c0392b" : s.daysOverdue > 0 ? "#d97706" : "#002957", href: `/admin/jobs/${s.id}` }))} />
              <ul className="mt-2 flex flex-wrap gap-3 px-1 text-[12px] text-muted-foreground">
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#002957]" />Due today</li>
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#d97706]" />Overdue</li>
                <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-[#c0392b]" />2+ weeks overdue / emergency</li>
              </ul>
            </>
          ) : (
            <p className="p-3 text-[13px] text-muted-foreground">Add a Google Maps key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in Vercel) to see today&apos;s route on a map.</p>
          )}
        </div>
      </aside>

      {completing && <CompleteDialog stop={completing} onClose={() => setCompleting(null)} />}
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: "danger" | "good" }) {
  return (
    <div className="rounded-xl border bg-surface px-3 py-2.5">
      <p className={cn("text-2xl font-semibold tabular-nums", tone === "danger" && "text-danger", tone === "good" && "text-accent-strong")}>{value}</p>
      <p className="text-[12px] text-muted-foreground">{label}</p>
    </div>
  );
}

function StopCard({ s, n, canComplete, canReschedule, today, onComplete }: { s: BoardStop; n: number; canComplete: boolean; canReschedule: boolean; today: string; onComplete: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const move = (date: string) =>
    start(async () => {
      const res = await moveJobAction(s.id, date);
      if (res.ok) {
        toast.success(`${s.location} moved to ${date}.`);
        router.refresh();
      } else toast.error(res.error);
    });
  return (
    <li className={cn("rounded-xl border bg-surface p-4 shadow-card", s.emergency && "border-danger/50", pending && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white", s.emergency || s.daysOverdue >= 14 ? "bg-danger" : s.daysOverdue > 0 ? "bg-warning" : "bg-brand")}>{n}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/admin/jobs/${s.id}`} className="text-[16px] font-semibold leading-tight hover:text-brand">{s.location}</Link>
            <DueBadge s={s} />
            {s.emergency && <span className="flex items-center gap-1 rounded-full bg-danger px-2 py-0.5 text-[12px] font-semibold text-white"><Siren className="h-3 w-3" />Emergency</span>}
          </div>
          {s.customer !== s.location && <p className="text-[13px] text-muted-foreground">{s.customer}</p>}
          <a href={directions(s.address)} target="_blank" rel="noreferrer" className="mt-1 flex items-start gap-1.5 text-[14px] text-foreground hover:text-brand"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />{s.address}</a>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground">
            <span>{s.service}</span>
            {s.recurring && <span className="flex items-center gap-1"><Repeat className="h-3 w-3" />Recurring</span>}
            {s.estimatedGallons ? <span className="tabular-nums">~{s.estimatedGallons.toLocaleString()} gal</span> : null}
            {s.window && <span>{s.window}</span>}
            {s.daysOverdue > 0 && <span>Due {s.dueLabel}</span>}
          </p>
          {s.access && <p className="mt-1 text-[13px] text-muted-foreground">Access: {s.access}</p>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {s.contacts.length === 0 && <span className="text-[13px] text-muted-foreground">No phone number on file.</span>}
        {s.contacts.map((c) => (
          <div key={c.phone} className="flex min-w-0 items-center gap-1 rounded-lg border bg-subtle/50 py-1 pl-3 pr-1">
            <span className="mr-1 min-w-0 truncate text-[13px]"><span className="font-medium">{c.name}</span> <span className="text-muted-foreground tabular-nums">{c.phone}</span></span>
            <a href={`tel:${tel(c.phone)}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-brand px-2.5 text-[13px] font-semibold text-white" aria-label={`Call ${c.name}`}><Phone className="h-3.5 w-3.5" />Call</a>
            <a href={`sms:${tel(c.phone)}?&body=${encodeURIComponent(`Hi, this is Sewer Squad — we're on the way to ${s.location} for your ${s.service.toLowerCase()}.`)}`} className="inline-flex h-8 items-center rounded-md border bg-surface px-2" aria-label={`Text ${c.name}`}><MessageSquare className="h-3.5 w-3.5" /></a>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2 border-t pt-3">
        {canComplete && (
          <Button onClick={onComplete} className="h-11 flex-1 bg-accent-strong text-[15px] hover:bg-accent-strong/90 sm:flex-none sm:px-6" disabled={pending}>
            <CheckCircle2 /> {s.status === "SUBMITTED" ? "Approve & send" : "Completed"}
          </Button>
        )}
        {canReschedule && ["SCHEDULED", "ASSIGNED", "ACCEPTED", "MISSED", "UNABLE_TO_SERVICE"].includes(s.status) && (
          <label className="flex h-11 items-center gap-1.5 rounded-md border px-2 text-[13px] text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span className="sr-only sm:not-sr-only">Move to</span>
            <input type="date" min={today} aria-label={`Move ${s.location} to another day`} disabled={pending} onChange={(e) => e.target.value && move(e.target.value)} className="w-[122px] bg-transparent text-[13px] text-foreground outline-none" />
          </label>
        )}
      </div>
    </li>
  );
}

function DoneRow({ s, canResend }: { s: BoardStop; canResend: boolean }) {
  const [pending, start] = React.useTransition();
  const resend = () =>
    start(async () => {
      const res = await resendCompletionAction(s.id);
      if (res.ok && res.data) reportResult(res.data, "Sent again");
      else if (!res.ok) toast.error(res.error);
    });
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <Link href={`/admin/jobs/${s.id}`} className="flex items-center gap-1.5 truncate text-[14px] font-medium hover:text-brand"><CheckCircle2 className="h-4 w-4 shrink-0 text-accent-strong" />{s.location}</Link>
        <p className="truncate text-[12px] text-muted-foreground">{s.service}{s.invoice ? ` · Invoice ${s.invoice}` : ""}</p>
      </div>
      {canResend && <Button size="sm" variant="secondary" onClick={resend} disabled={pending}>{pending ? "Sending…" : "Resend to customer"}</Button>}
    </li>
  );
}

type Result = { invoiceNumber: string | null; invoiceSent: boolean; emailedTo: string[]; texted: number; problems: string[] };

function reportResult(r: Result, lead = "Completed") {
  const parts = [r.invoiceSent && r.invoiceNumber ? `Invoice ${r.invoiceNumber} sent` : null, r.emailedTo.length ? `emailed ${r.emailedTo.join(", ")}` : null, r.texted ? `texted ${r.texted} contact${r.texted > 1 ? "s" : ""}` : null].filter(Boolean);
  toast.success(`${lead}${parts.length ? ` — ${parts.join(" · ")}` : ""}.`, { duration: 8000 });
  for (const p of r.problems) toast.warning(p, { duration: 12000 });
}

const SIG_KEY = "ss.driverSignature";

function PhotoPicker({ label, name, files, setFiles, accept = "image/*" }: { label: string; name: string; files: File[]; setFiles: (f: File[]) => void; accept?: string }) {
  return (
    <div>
      <p className="text-[14px] font-medium">{label}</p>
      <label className="mt-1.5 flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input px-3 py-4 text-[14px] text-muted-foreground hover:bg-subtle">
        <Camera className="h-4 w-4" />{files.length ? `${files.length} added — tap to add more` : "Take or choose photos"}
        <input type="file" name={name} accept={accept} multiple capture="environment" className="sr-only" onChange={(e) => { setFiles([...files, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }} />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {f.type.startsWith("image/") ? <img src={URL.createObjectURL(f)} alt="" className="h-16 w-16 rounded-md border object-cover" /> : <span className="flex h-16 w-16 items-center justify-center rounded-md border text-[11px]">{f.name.slice(-12)}</span>}
              <button type="button" onClick={() => setFiles(files.filter((_, j) => j !== i))} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[12px] text-surface" aria-label="Remove photo">×</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type CompletableJob = Pick<BoardStop, "id" | "status" | "location" | "assets" | "cityManifest">;

/** "Completed" / "Resend to customer" for the job page. */
export function CompleteJobButton({ job, completed }: { job: CompletableJob; completed: boolean }) {
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  if (completed)
    return (
      <Button variant="secondary" className="w-full" disabled={pending} onClick={() => start(async () => {
        const res = await resendCompletionAction(job.id);
        if (res.ok && res.data) reportResult(res.data, "Sent");
        else if (!res.ok) toast.error(res.error);
      })}>{pending ? "Sending…" : "Email & text paperwork to customer"}</Button>
    );
  return (
    <>
      <Button className="h-11 w-full bg-accent-strong text-[15px] hover:bg-accent-strong/90" onClick={() => setOpen(true)}><CheckCircle2 /> {job.status === "SUBMITTED" ? "Approve & send" : "Completed"}</Button>
      {open && <CompleteDialog stop={job} onClose={() => setOpen(false)} />}
    </>
  );
}

function CompleteDialog({ stop: s, onClose }: { stop: CompletableJob; onClose: () => void }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [before, setBefore] = React.useState<File[]>([]);
  const [after, setAfter] = React.useState<File[]>([]);
  const [city, setCity] = React.useState<File[]>([]);
  const [unavailable, setUnavailable] = React.useState(false);
  const [customerSig, setCustomerSig] = React.useState("");
  const [saved, setSaved] = React.useState<string>("");
  const [driverSig, setDriverSig] = React.useState("");
  const [remember, setRemember] = React.useState(true);
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const approveOnly = s.status === "SUBMITTED";

  React.useEffect(() => {
    try {
      const v = localStorage.getItem(SIG_KEY) ?? "";
      setSaved(v);
      setDriverSig(v);
    } catch {
      /* private mode */
    }
  }, []);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    start(async () => {
      const fd = new FormData();
      fd.set("jobId", s.id);
      fd.set("certify", "on");
      if (!approveOnly) {
        const data = new FormData(form);
        for (const k of ["gallons", "notes", "customerSignerName", "customerUnavailableReason"]) {
          const v = data.get(k);
          if (typeof v === "string" && v.trim()) fd.set(k, v);
        }
        for (const a of s.assets) {
          fd.append("assetIds[]", a.id);
          fd.append("assetGallons[]", String(data.get(`gal_${a.id}`) ?? ""));
        }
        if (unavailable) fd.set("customerUnavailable", "on");
        else if (customerSig) fd.set("customerSignature", customerSig);
        if (driverSig) fd.set("driverSignature", driverSig);
        const add = async (files: File[], phase: string) => {
          for (const f of files) {
            const blob = f.type.startsWith("image/") ? await compressImage(f) : f;
            fd.append(`photo_${phase}`, blob, blob === f ? f.name : f.name.replace(/\.\w+$/, "") + ".jpg");
          }
        };
        await add(before, "BEFORE");
        await add(after, "AFTER");
        await add(city, "CITY_MANIFEST");
      } else {
        fd.set("driverSignature", "x"); // already signed in the driver app
        fd.set("customerUnavailable", "on");
        fd.set("customerUnavailableReason", "n/a");
      }
      const res = await completeJobAction(fd);
      if (res.ok && res.data) {
        try {
          if (remember && driverSig) localStorage.setItem(SIG_KEY, driverSig);
        } catch {
          /* ignore */
        }
        reportResult(res.data);
        onClose();
        router.refresh();
      } else if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };
  const err = (k: string) => errors[k]?.[0];

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent size="lg" title={approveOnly ? `Approve & send — ${s.location}` : `Complete ${s.location}`} description={approveOnly ? "Already documented in the driver app. This finalizes the manifest, sends the invoice and emails the customer." : "Saves the service, finalizes the manifest, sends the invoice, and emails & texts the customer the photos, manifest and invoice."}>
        <form onSubmit={submit} className="space-y-5">
          {!approveOnly && (
            <>
              <fieldset className="space-y-2">
                <legend className="text-[14px] font-medium">Gallons pumped</legend>
                {s.assets.length ? (
                  s.assets.map((a) => (
                    <label key={a.id} className="flex items-center gap-3 text-[14px]">
                      <span className="min-w-0 flex-1 truncate">{a.label}{a.capacity ? <span className="text-muted-foreground"> · {a.capacity.toLocaleString()} gal</span> : null}</span>
                      <Input name={`gal_${a.id}`} inputMode="numeric" pattern="\d*" required className="h-11 w-32 text-right text-[16px]" placeholder="gal" />
                    </label>
                  ))
                ) : (
                  <Input name="gallons" inputMode="numeric" pattern="\d*" required className="h-11 w-40 text-[16px]" placeholder="Total gallons" />
                )}
                {(err("gallons") || err("assetGallons")) && <p className="text-[13px] text-danger">{err("gallons") ?? err("assetGallons")}</p>}
              </fieldset>

              <div className="grid gap-4 sm:grid-cols-2">
                <PhotoPicker label="Before photos" name="before" files={before} setFiles={setBefore} />
                <PhotoPicker label="After photos" name="after" files={after} setFiles={setAfter} />
              </div>
              {s.cityManifest && <PhotoPicker label="City of Houston manifest (photo)" name="city" files={city} setFiles={setCity} accept="image/*,application/pdf" />}

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} /> No one on site to sign</label>
                {unavailable ? (
                  <Input name="customerUnavailableReason" defaultValue="No representative available on site" aria-label="Why the customer could not sign" />
                ) : (
                  <>
                    <Input name="customerSignerName" placeholder="Customer's name" aria-label="Customer's name" className="h-11" />
                    {err("customerSignerName") && <p className="text-[13px] text-danger">{err("customerSignerName")}</p>}
                    <SignaturePad label="Customer signature" onChange={setCustomerSig} />
                    {err("customerSignature") && <p className="text-[13px] text-danger">{err("customerSignature")}</p>}
                  </>
                )}
              </div>

              <div>
                {saved && driverSig === saved ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={saved} alt="Your saved signature" className="h-12 w-auto" />
                    <Button type="button" variant="ghost" size="sm" onClick={() => setDriverSig("")}>Sign again</Button>
                  </div>
                ) : (
                  <SignaturePad label="Your signature (driver)" onChange={setDriverSig} />
                )}
                <label className="mt-1.5 flex items-center gap-2 text-[13px] text-muted-foreground"><Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Remember my signature on this device</label>
                {err("driverSignature") && <p className="text-[13px] text-danger">{err("driverSignature")}</p>}
              </div>

              <Textarea name="notes" rows={2} placeholder="Notes for the manifest (optional)" aria-label="Notes" />
              <p className="text-[12px] text-muted-foreground">By tapping Complete, I certify the information above is accurate.</p>
            </>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="h-11 flex-1 bg-accent-strong text-[15px] hover:bg-accent-strong/90" disabled={pending}>{pending ? "Sending…" : approveOnly ? "Approve & send to customer" : "Complete & send to customer"}</Button>
            <Button type="button" variant="secondary" className="h-11" onClick={onClose} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
