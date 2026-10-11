"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Camera, Check, CheckCircle2, ChevronLeft, ChevronRight, CloudOff, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { SignaturePad } from "@/components/driver/signature-pad";
import { cn } from "@/lib/utils";
import { clearLocalDraft, compressImage, listQueuedPhotos, loadLocalDraft, offlineAvailable, queuePhoto, removeQueuedPhoto, saveLocalDraft } from "@/lib/offline-store";
import { addChargeAction, deletePhotoAction, saveDraftAction, submissionCheckAction, submitJobAction, uploadPhotoAction } from "../../../actions";

type AssetRow = { assetId: string; gallonsPumped: string; servicePerformed: string; conditionAfter: string };
type Draft = {
  conditionBefore: string;
  accessIssues: string;
  unusualConditions: string;
  conditionAfter: string;
  issuesFound: string;
  followUpRecommendations: string;
  additionalWork: string;
  wasteType: string;
  notes: string;
  startedAt: string | null;
  assets: AssetRow[];
};
type Asset = { id: string; assetTag: string; type: string; capacityGallons: number; installLocation: string | null; label: string; planned: boolean };
type Photo = { id: string; phase: string; url: string; queued?: boolean };
type SyncState = "idle" | "local" | "syncing" | "synced" | "offline" | "error";

const STEPS = ["Arrival", "Before", "Pumping", "After", "Manifest", "Signatures", "Submit"] as const;

const EMPTY: Draft = { conditionBefore: "", accessIssues: "", unusualConditions: "", conditionAfter: "", issuesFound: "", followUpRecommendations: "", additionalWork: "", wasteType: "", notes: "", startedAt: null, assets: [] };

function toServer(d: Draft, clientVersion: number) {
  return {
    ...Object.fromEntries(Object.entries(d).filter(([k]) => k !== "assets" && k !== "startedAt").map(([k, v]) => [k, (v as string) || null])),
    startedAt: d.startedAt,
    clientVersion,
    assets: d.assets.filter((a) => a.gallonsPumped !== "").map((a) => ({ assetId: a.assetId, gallonsPumped: Number(a.gallonsPumped), servicePerformed: a.servicePerformed || null, conditionAfter: a.conditionAfter || null, wasteType: d.wasteType || null })),
  };
}

export function CompletionWizard({
  job,
  assets,
  wasteTypes,
  photos: initialPhotos,
  charges,
  server,
}: {
  job: { id: string; jobNumber: string; status: string; locationName: string; address: string; instructions: string; driverName: string; truck: string | null; rejection: string | null };
  assets: Asset[];
  wasteTypes: string[];
  photos: Photo[];
  charges: { id: string; description: string; status: string }[];
  server: { clientVersion: number; draft: Draft | null };
}) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [draft, setDraft] = React.useState<Draft>(() => server.draft ?? { ...EMPTY, startedAt: new Date().toISOString(), assets: assets.filter((a) => a.planned).map((a) => ({ assetId: a.id, gallonsPumped: "", servicePerformed: "Full pump-out", conditionAfter: "" })) });
  const [sync, setSync] = React.useState<SyncState>("idle");
  const [online, setOnline] = React.useState(true);
  const [photos, setPhotos] = React.useState<Photo[]>(initialPhotos);
  const [uploading, setUploading] = React.useState(0);
  const version = React.useRef(server.clientVersion);
  const dirty = React.useRef(false);
  const loaded = React.useRef(false);

  // ── Restore unsynced local draft & queued photos ──
  React.useEffect(() => {
    setOnline(navigator.onLine);
    if (!offlineAvailable()) {
      loaded.current = true;
      return;
    }
    (async () => {
      const local = await loadLocalDraft<{ draft: Draft; dirty: boolean }>(job.id).catch(() => null);
      if (local?.value.dirty) {
        setDraft(local.value.draft);
        dirty.current = true;
        setSync("local");
        toast.info("Restored unsynced work saved on this device.");
      }
      const queued = await listQueuedPhotos(job.id).catch(() => []);
      if (queued.length) setPhotos((p) => [...p, ...queued.map((q) => ({ id: q.id, phase: q.phase, url: URL.createObjectURL(q.blob), queued: true }))]);
      loaded.current = true;
    })();
  }, [job.id]);

  // ── Server sync ──
  const pushToServer = React.useCallback(async (d: Draft) => {
    if (!navigator.onLine) {
      setSync("offline");
      return false;
    }
    setSync("syncing");
    const res = await saveDraftAction(job.id, toServer(d, version.current));
    if (res.ok) {
      version.current = (res.data as { clientVersion: number }).clientVersion;
      dirty.current = false;
      await saveLocalDraft(job.id, { draft: d, dirty: false }).catch(() => undefined);
      setSync("synced");
      return true;
    }
    setSync("error");
    toast.error(res.error);
    return false;
  }, [job.id]);

  const flushPhotos = React.useCallback(async () => {
    if (!offlineAvailable() || !navigator.onLine) return;
    const queued = await listQueuedPhotos(job.id).catch(() => []);
    for (const q of queued) {
      const fd = new FormData();
      fd.set("jobId", job.id);
      fd.set("phase", q.phase);
      if (q.assetId) fd.set("assetId", q.assetId);
      fd.set("file", new File([q.blob], q.name, { type: q.type }));
      const res = await uploadPhotoAction(fd);
      if (res.ok) {
        await removeQueuedPhoto(q.id);
        setPhotos((p) => p.map((x) => (x.id === q.id ? { id: (res.data as { id: string }).id, phase: q.phase, url: `/api/documents/${(res.data as { id: string }).id}` } : x)));
      } else {
        toast.error(`Photo upload failed: ${res.error}`);
        break;
      }
    }
  }, [job.id]);

  // Save locally on every change, sync to server shortly after.
  React.useEffect(() => {
    if (!loaded.current) return;
    dirty.current = true;
    const local = setTimeout(() => {
      if (offlineAvailable()) saveLocalDraft(job.id, { draft, dirty: true }).then(() => setSync((s) => (s === "syncing" ? s : "local"))).catch(() => undefined);
    }, 300);
    const remote = setTimeout(() => void pushToServer(draft), 1800);
    return () => {
      clearTimeout(local);
      clearTimeout(remote);
    };
  }, [draft, job.id, pushToServer]);

  React.useEffect(() => {
    const on = () => {
      setOnline(true);
      void flushPhotos();
      if (dirty.current) void pushToServer(draft);
    };
    const off = () => {
      setOnline(false);
      setSync("offline");
    };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty.current || photos.some((p) => p.queued)) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
      window.removeEventListener("beforeunload", warn);
    };
  }, [draft, flushPhotos, pushToServer, photos]);

  React.useEffect(() => {
    void flushPhotos();
  }, [flushPhotos]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setAsset = (assetId: string, patch: Partial<AssetRow>) => setDraft((d) => ({ ...d, assets: d.assets.map((a) => (a.assetId === assetId ? { ...a, ...patch } : a)) }));

  // ── Photos ──
  async function addPhotos(files: FileList | null, phase: "BEFORE" | "AFTER") {
    if (!files) return;
    for (const file of Array.from(files)) {
      setUploading((n) => n + 1);
      try {
        const blob = await compressImage(file);
        const name = blob === file ? file.name : file.name.replace(/\.\w+$/, "") + ".jpg";
        let done = false;
        if (navigator.onLine) {
          const fd = new FormData();
          fd.set("jobId", job.id);
          fd.set("phase", phase);
          fd.set("file", new File([blob], name, { type: blob.type || file.type }));
          const res = await uploadPhotoAction(fd).catch(() => null);
          if (res?.ok) {
            const id = (res.data as { id: string }).id;
            setPhotos((p) => [...p, { id, phase, url: `/api/documents/${id}` }]);
            done = true;
          } else if (res && !res.ok) {
            toast.error(res.error);
            done = true; // validation error — do not queue invalid files
          }
        }
        if (!done) {
          if (!offlineAvailable()) {
            toast.error("You're offline and this device can't store photos. Try again when connected.");
          } else {
            const q = await queuePhoto({ jobId: job.id, phase, assetId: null, name, type: blob.type || file.type }, blob);
            setPhotos((p) => [...p, { id: q.id, phase, url: URL.createObjectURL(blob), queued: true }]);
            toast.info("Photo saved on this device — it will upload when you're back online.");
          }
        }
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function removePhoto(p: Photo) {
    if (p.queued) await removeQueuedPhoto(p.id);
    else {
      const res = await deletePhotoAction(job.id, p.id);
      if (!res.ok) return toast.error(res.error);
    }
    setPhotos((list) => list.filter((x) => x.id !== p.id));
  }

  const queuedCount = photos.filter((p) => p.queued).length;
  const totalGallons = draft.assets.reduce((s, a) => s + (Number(a.gallonsPumped) || 0), 0);
  const assetById = (id: string) => assets.find((a) => a.id === id)!;

  const next = async () => {
    if (step === 2 && draft.assets.every((a) => a.gallonsPumped === "")) return toast.error("Enter gallons pumped for at least one piece of equipment.");
    if (dirty.current) await pushToServer(draft);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
    window.scrollTo({ top: 0 });
  };

  return (
    <div className="space-y-4 pb-24">
      <div>
        <p className="text-[13px] text-muted-foreground">{job.jobNumber} · {job.locationName}</p>
        <h1 className="text-xl font-semibold">{STEPS[step]}</h1>
      </div>
      <ol className="flex gap-1" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} aria-label={`Step ${i + 1}: ${s}`} className={cn("h-2 w-full rounded-full", i < step ? "bg-brand" : i === step ? "bg-brand/60" : "bg-subtle")} />
          </li>
        ))}
      </ol>
      <SyncBadge state={sync} online={online} queued={queuedCount} onRetry={() => { void pushToServer(draft); void flushPhotos(); }} />
      {job.rejection && <Alert tone="danger" title="Office requested a correction">{job.rejection}</Alert>}

      {step === 0 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-surface p-4 shadow-card">
            <p className="text-[16px] font-semibold">{job.locationName}</p>
            <p className="text-[14px] text-muted-foreground">{job.address}</p>
            {job.instructions && <p className="mt-3 whitespace-pre-wrap rounded-md bg-warning-soft px-3 py-2 text-[14px]">{job.instructions}</p>}
          </div>
          <p className="text-[15px] font-medium">Confirm the equipment you&apos;re servicing</p>
          <div className="space-y-2">
            {assets.map((a) => {
              const on = draft.assets.some((x) => x.assetId === a.id);
              return (
                <label key={a.id} className={cn("flex min-h-14 items-center gap-3 rounded-xl border bg-surface px-4 py-3", on && "border-brand bg-brand-soft/40")}>
                  <input
                    type="checkbox"
                    className="h-6 w-6 accent-[hsl(var(--brand))]"
                    checked={on}
                    onChange={(e) => set("assets", e.target.checked ? [...draft.assets, { assetId: a.id, gallonsPumped: "", servicePerformed: "Full pump-out", conditionAfter: "" }] : draft.assets.filter((x) => x.assetId !== a.id))}
                  />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-medium">{a.label} · {a.capacityGallons.toLocaleString()} gal</span>
                    <span className="block text-[13px] text-muted-foreground">{a.assetTag}{a.installLocation ? ` · ${a.installLocation}` : ""}{!a.planned ? " · not on this job" : ""}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <PhotoSection title="Before-service photos" phase="BEFORE" photos={photos} onAdd={addPhotos} onRemove={removePhoto} uploading={uploading} />
          <TextBlock label="Equipment condition" value={draft.conditionBefore} onChange={(v) => set("conditionBefore", v)} placeholder="e.g. Heavy grease cap ~8 in., baffles intact" />
          <TextBlock label="Accessibility issues" value={draft.accessIssues} onChange={(v) => set("accessIssues", v)} placeholder="e.g. Lid under parked car — moved by manager" />
          <TextBlock label="Unusual conditions" value={draft.unusualConditions} onChange={(v) => set("unusualConditions", v)} />
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <Label htmlFor="waste">Waste type</Label>
            <Select id="waste" className="mt-1.5 h-12 text-[15px]" value={draft.wasteType} onChange={(e) => set("wasteType", e.target.value)}>
              <option value="">Select…</option>
              {wasteTypes.map((w) => <option key={w} value={w}>{w}</option>)}
            </Select>
          </div>
          {draft.assets.length === 0 && <Alert tone="warning">Select at least one piece of equipment on the Arrival step.</Alert>}
          {draft.assets.map((row) => {
            const a = assetById(row.assetId);
            const over = Number(row.gallonsPumped) > a.capacityGallons * 1.25;
            return (
              <div key={row.assetId} className="space-y-3 rounded-xl border bg-surface p-4 shadow-card">
                <p className="text-[15px] font-semibold">{a.label} · {a.capacityGallons.toLocaleString()} gal <span className="font-normal text-muted-foreground">({a.assetTag})</span></p>
                <div>
                  <Label htmlFor={`g-${a.id}`}>Actual gallons pumped</Label>
                  <Input id={`g-${a.id}`} inputMode="numeric" pattern="[0-9]*" className="mt-1.5 h-14 text-xl tabular-nums" value={row.gallonsPumped} onChange={(e) => setAsset(a.id, { gallonsPumped: e.target.value.replace(/\D/g, "").slice(0, 6) })} placeholder="0" />
                  {over && <p className="mt-1 text-[13px] text-warning">That&apos;s more than 125% of the listed capacity — double-check the reading.</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {["Full pump-out", "Pump-out & scrape walls", "Partial pump", "Line jetting"].map((s) => (
                    <button type="button" key={s} onClick={() => setAsset(a.id, { servicePerformed: s })} className={cn("h-10 rounded-full border px-4 text-[14px]", row.servicePerformed === s ? "border-brand bg-brand-soft text-brand" : "bg-surface")}>{s}</button>
                  ))}
                </div>
              </div>
            );
          })}
          <TextBlock label="Additional work performed" value={draft.additionalWork} onChange={(v) => set("additionalWork", v)} />
          <TextBlock label="Notes" value={draft.notes} onChange={(v) => set("notes", v)} />
          <p className="text-[14px] text-muted-foreground">Total: <span className="font-semibold text-foreground tabular-nums">{totalGallons.toLocaleString()} gal</span> · started {draft.startedAt ? new Date(draft.startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <PhotoSection title="After-service photos" phase="AFTER" photos={photos} onAdd={addPhotos} onRemove={removePhoto} uploading={uploading} />
          <TextBlock label="Condition after pumping" value={draft.conditionAfter} onChange={(v) => set("conditionAfter", v)} placeholder="e.g. Pumped to bottom, outlet clear" />
          <TextBlock label="Issues found" value={draft.issuesFound} onChange={(v) => set("issuesFound", v)} />
          <TextBlock label="Recommended follow-up" value={draft.followUpRecommendations} onChange={(v) => set("followUpRecommendations", v)} placeholder="e.g. Replace cracked lid gasket" />
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <div className="rounded-xl border bg-surface p-4 shadow-card">
            <p className="text-[13px] font-medium uppercase tracking-wide text-muted-foreground">Digital manifest (from your entries)</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-[14px]">
              <div><dt className="text-muted-foreground">Generator</dt><dd className="font-medium">{job.locationName}</dd></div>
              <div><dt className="text-muted-foreground">Waste type</dt><dd className="font-medium">{draft.wasteType || <span className="text-danger">Missing</span>}</dd></div>
              <div><dt className="text-muted-foreground">Gallons</dt><dd className="font-medium tabular-nums">{totalGallons.toLocaleString()}</dd></div>
              <div><dt className="text-muted-foreground">Driver · Truck</dt><dd className="font-medium">{job.driverName} · {job.truck ?? "—"}</dd></div>
            </dl>
            <ul className="mt-3 divide-y border-t text-[14px]">
              {draft.assets.filter((a) => a.gallonsPumped !== "").map((r) => <li key={r.assetId} className="flex justify-between py-2"><span>{assetById(r.assetId).label} ({assetById(r.assetId).assetTag})</span><span className="tabular-nums">{Number(r.gallonsPumped).toLocaleString()} gal</span></li>)}
            </ul>
            <p className="mt-3 text-[12px] text-muted-foreground">Hauler certification and disposal details are added from company and disposal records. The office verifies everything before the manifest is finalized.</p>
          </div>
          <ChargeForm jobId={job.id} charges={charges} />
        </div>
      )}

      {step >= 5 && (
        <SubmitStep jobId={job.id} driverName={job.driverName} showSignatures={step === 5} queued={queuedCount} ensureSynced={async () => (dirty.current ? pushToServer(draft) : true)} onSubmitted={async () => { await clearLocalDraft(job.id).catch(() => undefined); dirty.current = false; router.push(`/driver/jobs/${job.id}?submitted=1`); router.refresh(); }} goToSubmit={() => setStep(6)} />
      )}

      <div className="fixed inset-x-0 bottom-16 z-20 border-t bg-surface/95 px-4 py-3 backdrop-blur pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
        <div className="mx-auto flex max-w-3xl gap-2">
          <Button type="button" variant="secondary" size="xl" className="flex-1" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}><ChevronLeft /> Back</Button>
          {step < 5 && <Button type="button" size="xl" className="flex-[2]" onClick={next}>Next <ChevronRight /></Button>}
        </div>
      </div>
    </div>
  );
}

function SyncBadge({ state, online, queued, onRetry }: { state: SyncState; online: boolean; queued: number; onRetry: () => void }) {
  const msg = !online
    ? { icon: CloudOff, text: `Offline — saved on this device${queued ? ` · ${queued} photo${queued > 1 ? "s" : ""} waiting` : ""}`, cls: "bg-warning-soft text-warning" }
    : state === "syncing"
      ? { icon: Loader2, text: "Syncing…", cls: "bg-info-soft text-info" }
      : state === "error"
        ? { icon: AlertTriangle, text: "Sync failed — your work is kept on this device", cls: "bg-danger-soft text-danger" }
        : queued
          ? { icon: RefreshCw, text: `${queued} photo${queued > 1 ? "s" : ""} waiting to upload`, cls: "bg-warning-soft text-warning" }
          : state === "synced"
            ? { icon: CheckCircle2, text: "All changes saved", cls: "bg-success-soft text-success" }
            : state === "local"
              ? { icon: Check, text: "Saved on device — syncing shortly", cls: "bg-subtle text-muted-foreground" }
              : null;
  if (!msg) return null;
  return (
    <div role="status" className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[13px] font-medium", msg.cls)}>
      <span className="flex items-center gap-2"><msg.icon className={cn("h-4 w-4", state === "syncing" && "animate-spin")} /> {msg.text}</span>
      {(state === "error" || (online && queued > 0)) && <button type="button" onClick={onRetry} className="underline">Retry</button>}
    </div>
  );
}

function TextBlock({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const id = React.useId();
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} className="mt-1.5 text-[15px]" rows={2} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

function PhotoSection({ title, phase, photos, onAdd, onRemove, uploading }: { title: string; phase: "BEFORE" | "AFTER"; photos: Photo[]; onAdd: (f: FileList | null, phase: "BEFORE" | "AFTER") => void; onRemove: (p: Photo) => void; uploading: number }) {
  const mine = photos.filter((p) => p.phase === phase);
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <p className="text-[15px] font-medium">{title} <span className="text-[13px] font-normal text-muted-foreground">({mine.length}, at least 1 required)</span></p>
      <div className="grid grid-cols-3 gap-2">
        {mine.map((p) => (
          <div key={p.id} className="relative overflow-hidden rounded-lg border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.url} alt={`${phase.toLowerCase()} photo`} className="aspect-square w-full object-cover" />
            {p.queued && <span className="absolute left-1 top-1 rounded bg-warning px-1.5 text-[11px] font-medium text-white">Pending</span>}
            <button type="button" onClick={() => onRemove(p)} aria-label="Remove photo" className="absolute right-1 top-1 rounded-full bg-black/60 p-1.5 text-white"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
        <button type="button" onClick={() => ref.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-[13px] text-muted-foreground active:bg-subtle">
          {uploading ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
          Add photo
        </button>
      </div>
      <input ref={ref} type="file" accept="image/*" capture="environment" multiple className="hidden" onChange={(e) => { onAdd(e.target.files, phase); e.target.value = ""; }} />
    </div>
  );
}

function ChargeForm({ jobId, charges }: { jobId: string; charges: { id: string; description: string; status: string }[] }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-xl border bg-surface p-4 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-medium">Additional charges</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)}><Plus /> Add</Button>
      </div>
      <p className="text-[13px] text-muted-foreground">Only add charges you were authorized to apply. The office approves every charge before billing.</p>
      {charges.map((c) => <p key={c.id} className="mt-2 text-[14px]">{c.description} · <span className="text-muted-foreground">{c.status.replace(/_/g, " ").toLowerCase()}</span></p>)}
      {open && (
        <ActionForm action={addChargeAction} className="mt-3 grid grid-cols-2 gap-3" resetOnSuccess onSuccess={() => setOpen(false)}>
          <input type="hidden" name="jobId" value={jobId} />
          <Field label="Type" name="kind" className="col-span-2"><Select><option value="ADDITIONAL_EQUIPMENT">Additional equipment</option><option value="AFTER_HOURS">After-hours</option><option value="DISPOSAL_FEE">Disposal fee</option><option value="OTHER">Other</option></Select></Field>
          <Field label="Description" name="description" className="col-span-2"><Input /></Field>
          <Field label="Quantity" name="quantity"><Input inputMode="decimal" defaultValue="1" /></Field>
          <Field label="Unit price ($)" name="unitPrice"><Input inputMode="decimal" /></Field>
          <div className="col-span-2"><SubmitButton variant="secondary" className="w-full">Add charge</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}

function SubmitStep({ jobId, driverName, showSignatures, queued, ensureSynced, onSubmitted, goToSubmit }: { jobId: string; driverName: string; showSignatures: boolean; queued: number; ensureSynced: () => Promise<boolean>; onSubmitted: () => void; goToSubmit: () => void }) {
  const [customerSig, setCustomerSig] = React.useState("");
  const [driverSig, setDriverSig] = React.useState("");
  const [unavailable, setUnavailable] = React.useState(false);
  const [problems, setProblems] = React.useState<string[] | null>(null);
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    if (showSignatures) return;
    setChecking(true);
    (async () => {
      const synced = await ensureSynced();
      const res = await submissionCheckAction(jobId);
      setProblems(res.ok ? (res.data as string[]).concat(synced ? [] : ["Your latest changes haven't reached the server yet — connect and retry."]) : [res.error]);
      setChecking(false);
    })();
  }, [showSignatures, jobId, ensureSynced]);

  return (
    <ActionForm action={submitJobAction} refresh={false} onSuccess={onSubmitted} className="space-y-5">
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="customerSignature" value={customerSig} />
      <input type="hidden" name="driverSignature" value={driverSig} />
      <div className={cn("space-y-5", !showSignatures && "hidden")}>
        <div className="space-y-3 rounded-xl border bg-surface p-4 shadow-card">
          <p className="text-[15px] font-semibold">Customer acknowledgment</p>
          <label className="flex min-h-12 items-center gap-3 text-[15px]">
            <input type="checkbox" name="customerUnavailable" checked={unavailable} onChange={(e) => setUnavailable(e.target.checked)} className="h-6 w-6 accent-[hsl(var(--brand))]" />
            No customer representative available to sign
          </label>
          {unavailable ? (
            <Field label="Why was no one available?" name="customerUnavailableReason" required><Textarea rows={2} placeholder="e.g. After-hours service, site closed" /></Field>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Representative name" name="customerSignerName" required><Input autoComplete="off" className="h-12 text-[15px]" /></Field>
                <Field label="Title / position" name="customerSignerTitle"><Input className="h-12 text-[15px]" placeholder="Manager" /></Field>
              </div>
              <SignaturePad label="Customer signature" value={customerSig} onChange={setCustomerSig} />
            </>
          )}
        </div>
        <div className="space-y-3 rounded-xl border bg-surface p-4 shadow-card">
          <p className="text-[15px] font-semibold">Driver certification — {driverName}</p>
          <SignaturePad label="Your signature" value={driverSig} onChange={setDriverSig} />
          <label className="flex items-start gap-3 text-[14px]">
            <input type="checkbox" name="certify" className="mt-0.5 h-6 w-6 accent-[hsl(var(--brand))]" />
            I certify the service, volumes and photos recorded here are accurate. A signature is never entered on anyone else&apos;s behalf.
          </label>
        </div>
        <Button type="button" size="xl" className="w-full" onClick={goToSubmit} disabled={!driverSig || (!unavailable && !customerSig)}>Review & submit <ChevronRight /></Button>
      </div>
      {!showSignatures && (
        <div className="space-y-4">
          {checking && <p className="flex items-center gap-2 text-[14px] text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking documentation…</p>}
          {problems && problems.length > 0 && (
            <Alert tone="danger" title="Finish these before submitting">
              <ul className="list-disc pl-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Alert>
          )}
          {queued > 0 && <Alert tone="warning" title="Photos still uploading">Connect to upload {queued} saved photo{queued > 1 ? "s" : ""} before submitting.</Alert>}
          {problems && problems.length === 0 && queued === 0 && <Alert tone="success" title="Ready to submit">The office will review your documentation before the manifest is finalized.</Alert>}
          <SubmitButton size="xl" className="w-full" disabled={checking || !problems || problems.length > 0 || queued > 0 || !driverSig} pendingText="Submitting…">Submit job</SubmitButton>
        </div>
      )}
    </ActionForm>
  );
}
