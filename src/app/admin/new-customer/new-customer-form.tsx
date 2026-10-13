"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, CalendarDays, Loader2, MapPin, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Label, Select, Textarea } from "@/components/ui/input";
import { SERVICE_TYPE_LABEL, ASSET_TYPE_LABEL } from "@/lib/status";
import { MANIFEST_FEE_LABEL } from "@/domain/document-lines";
import { cn } from "@/lib/utils";
import { createCustomerWithServiceAction } from "@/app/admin/_actions/onboarding";

type Loc = {
  key: number;
  name: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  siteContactName: string;
  siteContactPhone: string;
  accessInstructions: string;
  manifestFee: string;
  trapType: string;
  trapGallons: string;
  jobType: "RECURRING" | "ONE_TIME" | "EMERGENCY";
  serviceType: string;
  date: string;
  intervalDays: string;
  pricingModel: "PER_GALLON" | "FLAT_RATE";
  price: string;
  notes: string;
};

const blank = (key: number, today: string): Loc => ({ key, name: "", addressLine1: "", city: "Houston", state: "TX", postalCode: "", siteContactName: "", siteContactPhone: "", accessInstructions: "", manifestFee: "NONE", trapType: "GREASE_TRAP", trapGallons: "", jobType: "RECURRING", serviceType: "GREASE_TRAP_PUMPING", date: today, intervalDays: "90", pricingModel: "PER_GALLON", price: "", notes: "" });

const JOB_TYPES = [
  { value: "RECURRING", label: "Recurring" },
  { value: "ONE_TIME", label: "One-time" },
  { value: "EMERGENCY", label: "Emergency" },
] as const;

function F({ label, error, hint, required, className, children }: { label: string; error?: string; hint?: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}{required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}</Label>
      {children}
      {error ? <p className="text-[12px] text-danger">{error}</p> : hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function NewCustomerForm({ today, prefill, leadId }: { today: string; prefill?: { name: string; contactName: string; email: string; phone: string }; leadId?: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string[]>>({});
  const [c, setC] = React.useState({ name: prefill?.name ?? "", type: "RESTAURANT", contactName: prefill?.contactName ?? "", contactTitle: "", phone: prefill?.phone ?? "", email: prefill?.email ?? "", smsOptIn: false, smsOptInSource: "", notes: "" });
  const [multiUnit, setMultiUnit] = React.useState(false);
  const [locs, setLocs] = React.useState<Loc[]>([blank(1, today)]);
  const nextKey = React.useRef(2);
  const shown = multiUnit ? locs : locs.slice(0, 1);

  const setL = (key: number, patch: Partial<Loc>) => setLocs((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const err = (path: string) => errors[path]?.[0];
  const add = () => {
    const last = locs.at(-1)!;
    // A new location starts with the previous one's service settings, a week later.
    const d = new Date(`${last.date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7);
    setLocs([...locs, { ...blank(nextKey.current++, today), city: last.city, jobType: last.jobType, serviceType: last.serviceType, intervalDays: last.intervalDays, pricingModel: last.pricingModel, price: last.price, manifestFee: last.manifestFee, date: d.toISOString().slice(0, 10) }]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    start(async () => {
      const payload = {
        ...c,
        leadId,
        multiUnit,
        locations: shown.map(({ key: _key, trapGallons, ...l }) => {
          void _key;
          return { ...l, name: l.name || undefined, trapGallons: trapGallons || undefined };
        }),
      };
      const res = await createCustomerWithServiceAction(payload);
      if (res.ok && res.data) {
        const n = res.data.scheduled.length;
        toast.success(`${c.name} added with ${n} service${n > 1 ? "s" : ""} scheduled.`);
        router.push(`/admin/customers/${res.data.organizationId}?created=1`);
      } else if (!res.ok) {
        setErrors(res.fieldErrors as Record<string, string[]> ?? {});
        toast.error(res.error);
      }
    });
  };

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <section className="rounded-xl border bg-surface p-4 shadow-card sm:p-5">
        <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold"><Building2 className="h-4 w-4 text-brand" />Customer</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <F label="Business name" required error={err("name")} className="sm:col-span-2"><Input value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder="e.g. Drip Dessert Lounge" autoFocus /></F>
          <F label="Contact name" required error={err("contactName")}><Input value={c.contactName} onChange={(e) => setC({ ...c, contactName: e.target.value })} /></F>
          <F label="Title" error={err("contactTitle")}><Input value={c.contactTitle} onChange={(e) => setC({ ...c, contactTitle: e.target.value })} placeholder="Owner, GM…" /></F>
          <F label="Mobile phone" error={err("phone")}><Input type="tel" inputMode="tel" value={c.phone} onChange={(e) => setC({ ...c, phone: e.target.value })} placeholder="(713) 555-0123" /></F>
          <F label="Email" error={err("email")} hint="Completed-job paperwork and invoices go here."><Input type="email" inputMode="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></F>
          <div className="space-y-2 sm:col-span-2">
            <label className="flex items-center gap-2 text-[14px]"><Checkbox checked={c.smsOptIn} onChange={(e) => setC({ ...c, smsOptIn: e.target.checked })} /> They agreed to text message updates</label>
            {c.smsOptIn && <F label="How they agreed" required error={err("smsOptInSource")}><Input value={c.smsOptInSource} onChange={(e) => setC({ ...c, smsOptInSource: e.target.value })} placeholder={`Verbal, on the phone ${new Date().toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}`} /></F>}
          </div>
          <F label="Business type"><Select value={c.type} onChange={(e) => setC({ ...c, type: e.target.value })}>
            <option value="RESTAURANT">Restaurant</option><option value="RESTAURANT_GROUP">Restaurant group</option><option value="HOTEL">Hotel</option><option value="GROCERY">Grocery</option><option value="SCHOOL">School</option><option value="HOSPITAL">Hospital</option><option value="INSTITUTIONAL">Institutional</option><option value="OTHER">Other</option>
          </Select></F>
          <F label="Notes"><Input value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} placeholder="Anything to remember" /></F>
        </div>
        <label className="mt-5 flex cursor-pointer items-center justify-between gap-3 rounded-lg border bg-subtle/60 px-4 py-3">
          <span>
            <span className="block text-[14px] font-semibold">Multi-unit account</span>
            <span className="block text-[13px] text-muted-foreground">More than one location — each can have its own service date.</span>
          </span>
          <span className="relative inline-flex h-6 w-11 shrink-0 items-center">
            <input type="checkbox" role="switch" checked={multiUnit} onChange={(e) => setMultiUnit(e.target.checked)} className="peer sr-only" aria-label="Multi-unit account" />
            <span className="absolute inset-0 rounded-full bg-border transition peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-ring" />
            <span className="absolute left-0.5 h-5 w-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
          </span>
        </label>
      </section>

      {shown.map((l, i) => (
        <section key={l.key} className="rounded-xl border bg-surface p-4 shadow-card sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[15px] font-semibold"><MapPin className="h-4 w-4 text-brand" />{multiUnit ? `Location ${i + 1}` : "Service address"}</h2>
            {multiUnit && shown.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setLocs(locs.filter((x) => x.key !== l.key))}><Trash2 /> Remove</Button>}
          </div>
          <div className="grid gap-4 sm:grid-cols-6">
            {multiUnit && <F label="Location name" required error={err(`locations.${i}.name`)} className="sm:col-span-6"><Input value={l.name} onChange={(e) => setL(l.key, { name: e.target.value })} placeholder="e.g. Westheimer, or Store #2" /></F>}
            <F label="Street address" required error={err(`locations.${i}.addressLine1`)} className="sm:col-span-6"><Input value={l.addressLine1} onChange={(e) => setL(l.key, { addressLine1: e.target.value })} autoComplete="street-address" /></F>
            <F label="City" required error={err(`locations.${i}.city`)} className="sm:col-span-3"><Input value={l.city} onChange={(e) => setL(l.key, { city: e.target.value })} /></F>
            <F label="State" error={err(`locations.${i}.state`)} className="sm:col-span-1"><Input value={l.state} maxLength={2} onChange={(e) => setL(l.key, { state: e.target.value.toUpperCase() })} /></F>
            <F label="ZIP" required error={err(`locations.${i}.postalCode`)} className="sm:col-span-2"><Input inputMode="numeric" value={l.postalCode} onChange={(e) => setL(l.key, { postalCode: e.target.value })} /></F>
            <F label="Trap type" className="sm:col-span-3"><Select value={l.trapType} onChange={(e) => setL(l.key, { trapType: e.target.value, serviceType: e.target.value === "GRIT_TRAP" ? "GRIT_TRAP_CLEANING" : e.target.value === "GREASE_INTERCEPTOR" ? "INTERCEPTOR_PUMPING" : e.target.value === "SEPTIC_TANK" ? "SEPTIC_PUMPING" : l.serviceType })}>
              {["GREASE_TRAP", "GREASE_INTERCEPTOR", "GRIT_TRAP", "SEPTIC_TANK", "LINT_TRAP", "LIFT_STATION", "OTHER"].map((t) => <option key={t} value={t}>{ASSET_TYPE_LABEL[t]}</option>)}
            </Select></F>
            <F label="Trap size (gallons)" error={err(`locations.${i}.trapGallons`)} className="sm:col-span-3"><Input inputMode="numeric" value={l.trapGallons} onChange={(e) => setL(l.key, { trapGallons: e.target.value })} placeholder="e.g. 1000" /></F>
          </div>

          <div className="mt-5 rounded-lg border bg-subtle/40 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-[14px] font-semibold"><CalendarDays className="h-4 w-4 text-brand" />Schedule service</h3>
            <div role="radiogroup" aria-label="Job type" className="mb-4 grid grid-cols-3 gap-1 rounded-lg border bg-surface p-1">
              {JOB_TYPES.map((t) => (
                <button key={t.value} type="button" role="radio" aria-checked={l.jobType === t.value} onClick={() => setL(l.key, { jobType: t.value })} className={cn("h-9 rounded-md text-[14px] font-medium transition", l.jobType === t.value ? (t.value === "EMERGENCY" ? "bg-danger text-white" : "bg-brand text-white") : "text-muted-foreground hover:bg-subtle")}>{t.label}</button>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-6">
              <F label="Service" className="sm:col-span-3"><Select value={l.serviceType} onChange={(e) => setL(l.key, { serviceType: e.target.value })}>{Object.entries(SERVICE_TYPE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select></F>
              <F label={l.jobType === "RECURRING" ? "First service date" : "Service date"} required error={err(`locations.${i}.date`)} className="sm:col-span-3"><Input type="date" value={l.date} onChange={(e) => setL(l.key, { date: e.target.value })} /></F>
              {l.jobType === "RECURRING" && (
                <F label="Repeat every (days)" error={err(`locations.${i}.intervalDays`)} hint="Counted from the day each service is completed." className="sm:col-span-2"><Input inputMode="numeric" value={l.intervalDays} onChange={(e) => setL(l.key, { intervalDays: e.target.value })} /></F>
              )}
              <F label="Pricing" className={l.jobType === "RECURRING" ? "sm:col-span-2" : "sm:col-span-3"}><Select value={l.pricingModel} onChange={(e) => setL(l.key, { pricingModel: e.target.value as Loc["pricingModel"] })}><option value="PER_GALLON">Per gallon</option><option value="FLAT_RATE">Flat rate</option></Select></F>
              <F label={l.pricingModel === "PER_GALLON" ? "Rate ($ / gal)" : "Price ($)"} error={err(`locations.${i}.price`)} hint="Leave blank to price later." className={l.jobType === "RECURRING" ? "sm:col-span-2" : "sm:col-span-3"}><Input inputMode="decimal" value={l.price} onChange={(e) => setL(l.key, { price: e.target.value })} placeholder={l.pricingModel === "PER_GALLON" ? "0.89" : "350.00"} /></F>
              <F label="Manifest fee" className="sm:col-span-3"><Select value={l.manifestFee} onChange={(e) => setL(l.key, { manifestFee: e.target.value })}>{Object.entries(MANIFEST_FEE_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select></F>
              <F label="Site contact phone" error={err(`locations.${i}.siteContactPhone`)} hint={multiUnit ? "Who to call at this location." : "If different from the main phone."} className="sm:col-span-3"><Input type="tel" value={l.siteContactPhone} onChange={(e) => setL(l.key, { siteContactPhone: e.target.value })} /></F>
              <F label="Notes for the driver" className="sm:col-span-6"><Textarea rows={2} value={l.notes} onChange={(e) => setL(l.key, { notes: e.target.value })} placeholder="Gate code, trap location, best time…" /></F>
            </div>
          </div>
        </section>
      ))}

      {multiUnit && <Button type="button" variant="secondary" className="w-full" onClick={add}><Plus /> Add another location</Button>}

      <div className="sticky bottom-0 -mx-4 border-t bg-background/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
        <Button type="submit" className="h-11 w-full text-[15px] sm:w-auto sm:px-8" disabled={pending}>{pending ? <><Loader2 className="animate-spin" /> Saving…</> : `Save customer & schedule ${shown.length > 1 ? `${shown.length} services` : "service"}`}</Button>
      </div>
    </form>
  );
}
