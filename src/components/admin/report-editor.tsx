"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { saveReportAction } from "@/app/admin/_actions/paperwork";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type Section = { title: string; body: string };
export type ReportInit = {
  id?: string;
  organizationId: string;
  locationId: string;
  jobId: string;
  invoiceId: string;
  preparedFor: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  serviceDate: string;
  subject: string;
  closing: string;
  sections: Section[];
};
type Org = { id: string; name: string; locations: { id: string; name: string; addressLine1: string; city: string; state: string; postalCode: string }[] };

export function ReportEditor({ init, orgs, presets }: { init: ReportInit; orgs: Org[]; presets: Section[] }) {
  const [r, setR] = React.useState(init);
  const set = (patch: Partial<ReportInit>) => setR((v) => ({ ...v, ...patch }));
  const org = orgs.find((o) => o.id === r.organizationId);
  const setSection = (i: number, patch: Partial<Section>) => set({ sections: r.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const move = (i: number, d: number) => {
    const next = [...r.sections];
    const [s] = next.splice(i, 1);
    next.splice(i + d, 0, s!);
    set({ sections: next });
  };
  const pickLocation = (locId: string) => {
    const loc = org?.locations.find((l) => l.id === locId);
    set({ locationId: locId, ...(loc ? { preparedFor: loc.name, addressLine1: loc.addressLine1, city: loc.city, state: loc.state, postalCode: loc.postalCode } : {}) });
  };
  return (
    <ActionForm action={saveReportAction as Act} className="space-y-6" refresh={!!r.id}>
      {r.id && <input type="hidden" name="reportId" value={r.id} />}
      <input type="hidden" name="jobId" value={r.jobId} />
      <input type="hidden" name="invoiceId" value={r.invoiceId} />
      <input type="hidden" name="sections" value={JSON.stringify(r.sections.filter((s) => s.title.trim() || s.body.trim()))} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Customer (optional)" name="organizationId">
          <Select value={r.organizationId} onChange={(e) => set({ organizationId: e.target.value, locationId: "" })}>
            <option value="">Not a customer yet</option>
            {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </Select>
        </Field>
        <Field label="Location" name="locationId">
          <Select value={r.locationId} onChange={(e) => pickLocation(e.target.value)} disabled={!org}>
            <option value="">{org ? "Select…" : "—"}</option>
            {org?.locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.addressLine1}</option>)}
          </Select>
        </Field>
        <Field label="Service date" name="serviceDate" required><Input type="date" value={r.serviceDate} onChange={(e) => set({ serviceDate: e.target.value })} /></Field>
        <Field label="Prepared for" name="preparedFor" required className="sm:col-span-2"><Input value={r.preparedFor} onChange={(e) => set({ preparedFor: e.target.value })} /></Field>
        <Field label="Address" name="addressLine1" required><Input value={r.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} /></Field>
        <Field label="City" name="city" required><Input value={r.city} onChange={(e) => set({ city: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="State" name="state" required><Input value={r.state} maxLength={2} onChange={(e) => set({ state: e.target.value })} /></Field>
          <Field label="ZIP" name="postalCode"><Input value={r.postalCode} onChange={(e) => set({ postalCode: e.target.value })} /></Field>
        </div>
        <Field label="Subject" name="subject" required><Input value={r.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="Sample Well & City Connection" /></Field>
      </div>
      <p className="text-[13px] text-muted-foreground">Write each section in plain sentences. Leave a blank line between paragraphs. Start a line with “•” or “-” to make a bullet.</p>
      {r.sections.map((s, i) => (
        <div key={i} className="space-y-2 rounded-lg border p-4">
          <div className="flex items-end gap-2">
            <Field label="Section heading" name={`h${i}`} className="flex-1"><Input value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} placeholder="Findings" /></Field>
            <Button type="button" variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Move down" disabled={i === r.sections.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove section" onClick={() => set({ sections: r.sections.filter((_, j) => j !== i) })}><Trash2 /></Button>
          </div>
          <Textarea aria-label={`${s.title || "Section"} text`} rows={5} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} />
        </div>
      ))}
      <div className="flex flex-wrap gap-2">
        {presets.map((p) => <Button key={p.title} type="button" variant="ghost" size="sm" onClick={() => set({ sections: [...r.sections, p] })}><Plus /> {p.title}</Button>)}
        <Button type="button" variant="ghost" size="sm" onClick={() => set({ sections: [...r.sections, { title: "", body: "" }] })}><Plus /> Blank section</Button>
      </div>
      <Field label="Closing line (printed in italics)" name="closing"><Textarea rows={2} value={r.closing} onChange={(e) => set({ closing: e.target.value })} /></Field>
      <SubmitButton>{r.id ? "Save changes" : "Create report"}</SubmitButton>
    </ActionForm>
  );
}
