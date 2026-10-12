"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { lineAmountCents } from "@/domain/invoice-math";
import { manifestFeeCents } from "@/domain/document-lines";
import { formatCents, parseDollarRateToCentsString } from "@/lib/money";
import { saveProposalAction } from "@/app/admin/_actions/paperwork";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
export type PLine = { kind: string; description: string; quantity: string; unitPrice: string };
export type PSection = { title: string; subtotalLabel: string; lines: PLine[] };
export type ProposalInit = {
  id?: string;
  kind: "PROPOSAL" | "QUOTE";
  organizationId: string;
  locationId: string;
  preparedFor: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  date: string;
  scopeTitle: string;
  scopeSubtitle: string;
  intro: string;
  note: string;
  priceNote: string;
  sections: PSection[];
};
type Org = { id: string; name: string; locations: { id: string; name: string; addressLine1: string; city: string; state: string; postalCode: string; manifestFee: string }[] };

const KINDS: [string, string][] = [
  ["PER_GALLON", "Per gallon"],
  ["FLAT_RATE", "Flat rate (trap service)"],
  ["SERVICE", "Service"],
  ["OTHER", "Extra (no manifest fee)"],
  ["MANIFEST_FEE", "Manifest fee (auto %)"],
  ["DISCOUNT", "Discount"],
];
const blank = (kind = "FLAT_RATE", description = ""): PLine => ({ kind, description, quantity: kind === "PER_GALLON" ? "" : "1", unitPrice: "" });

function sectionCents(lines: PLine[], bps: number) {
  const ok = (l: PLine) => /^\d+(\.\d{1,3})?$/.test(l.quantity) && parseDollarRateToCentsString(l.unitPrice) !== null;
  const base = lines.filter((l) => l.kind !== "MANIFEST_FEE" && ok(l)).map((l) => ({ kind: l.kind, amountCents: (l.kind === "DISCOUNT" ? -1 : 1) * lineAmountCents(l.quantity, parseDollarRateToCentsString(l.unitPrice)!) }));
  const fee = manifestFeeCents(base, bps);
  return { fee, lines: lines.map((l) => (l.kind === "MANIFEST_FEE" ? fee : ok(l) ? (l.kind === "DISCOUNT" ? -1 : 1) * lineAmountCents(l.quantity, parseDollarRateToCentsString(l.unitPrice)!) : null)), total: base.reduce((t, l) => t + l.amountCents, 0) + (lines.some((l) => l.kind === "MANIFEST_FEE") ? fee : 0) };
}

export function ProposalEditor({ init, orgs, manifestFeeBps, locked }: { init: ProposalInit; orgs: Org[]; manifestFeeBps: number; locked?: boolean }) {
  const [p, setP] = React.useState(init);
  const set = (patch: Partial<ProposalInit>) => setP((v) => ({ ...v, ...patch }));
  const org = orgs.find((o) => o.id === p.organizationId);
  const setSection = (i: number, patch: Partial<PSection>) => set({ sections: p.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const setLine = (si: number, li: number, patch: Partial<PLine>) => setSection(si, { lines: p.sections[si]!.lines.map((l, j) => (j === li ? { ...l, ...patch } : l)) });
  const priced = p.sections.map((s) => sectionCents(s.lines, manifestFeeBps));
  const total = Math.max(0, priced.reduce((t, s) => t + s.total, 0));
  const pickLocation = (locId: string) => {
    const loc = org?.locations.find((l) => l.id === locId);
    set({ locationId: locId, ...(loc ? { preparedFor: loc.name, addressLine1: loc.addressLine1, city: loc.city, state: loc.state, postalCode: loc.postalCode } : {}) });
  };
  const word = p.kind === "QUOTE" ? "quote" : "proposal";
  const sectionsJson = JSON.stringify(p.sections.map((s) => ({ title: s.title || undefined, subtotalLabel: s.subtotalLabel || undefined, lines: s.lines.filter((l) => l.description.trim()).map((l) => ({ ...l, unitPrice: l.kind === "MANIFEST_FEE" ? "0" : l.unitPrice })) })));

  return (
    <ActionForm action={saveProposalAction as Act} className="space-y-6" refresh={!!p.id}>
      {p.id && <input type="hidden" name="proposalId" value={p.id} />}
      <input type="hidden" name="kind" value={p.kind} />
      <input type="hidden" name="sections" value={sectionsJson} />
      <fieldset disabled={locked} className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Existing customer (optional)" name="organizationId" hint="Leave blank for a prospect.">
            <Select value={p.organizationId} onChange={(e) => set({ organizationId: e.target.value, locationId: "" })}>
              <option value="">Prospect — not a customer yet</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </Select>
          </Field>
          <Field label="Location" name="locationId">
            <Select value={p.locationId} onChange={(e) => pickLocation(e.target.value)} disabled={!org}>
              <option value="">{org ? "Select…" : "—"}</option>
              {org?.locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.addressLine1}</option>)}
            </Select>
          </Field>
          <Field label="Date" name="date" required><Input type="date" value={p.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Prepared for" name="preparedFor" required className="sm:col-span-2"><Input value={p.preparedFor} onChange={(e) => set({ preparedFor: e.target.value })} placeholder="Business name" /></Field>
          <Field label="Address" name="addressLine1" required><Input value={p.addressLine1} onChange={(e) => set({ addressLine1: e.target.value })} /></Field>
          <Field label="City" name="city" required><Input value={p.city} onChange={(e) => set({ city: e.target.value })} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="State" name="state" required><Input value={p.state} maxLength={2} onChange={(e) => set({ state: e.target.value })} /></Field>
            <Field label="ZIP" name="postalCode"><Input value={p.postalCode} onChange={(e) => set({ postalCode: e.target.value })} /></Field>
          </div>
          <Field label="Scope (printed under SCOPE)" name="scopeTitle" required><Input value={p.scopeTitle} onChange={(e) => set({ scopeTitle: e.target.value })} placeholder="Grease Trap Pumping & Disposal" /></Field>
          <Field label="Scope second line" name="scopeSubtitle" className="sm:col-span-2"><Input value={p.scopeSubtitle} onChange={(e) => set({ scopeSubtitle: e.target.value })} placeholder="Two concepts, one location" /></Field>
          <Field label="Intro paragraph" name="intro" className="sm:col-span-3"><Textarea rows={2} value={p.intro} onChange={(e) => set({ intro: e.target.value })} /></Field>
        </div>

        {p.sections.map((s, si) => (
          <div key={si} className="space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={p.sections.length > 1 ? `Section ${si + 1} heading` : "Section heading (optional)"} name={`sectionTitle${si}`} className="sm:col-span-2"><Input value={s.title} onChange={(e) => setSection(si, { title: e.target.value })} placeholder="HOLLANDS COFFEE — Grease Trap Service" /></Field>
              <Field label="Subtotal label (optional)" name={`subtotal${si}`}><Input value={s.subtotalLabel} onChange={(e) => setSection(si, { subtotalLabel: e.target.value })} placeholder="Hollands subtotal" /></Field>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-[12px] uppercase tracking-wide text-muted-foreground"><tr><th className="py-1 pr-2">Type</th><th className="py-1 pr-2">Description</th><th className="py-1 pr-2 text-right">Qty / gal</th><th className="py-1 pr-2 text-right">Price ($)</th><th className="py-1 text-right">Amount</th><th /></tr></thead>
                <tbody>
                  {s.lines.map((l, li) => (
                    <tr key={li}>
                      <td className="py-1 pr-2"><Select aria-label="Line type" value={l.kind} onChange={(e) => setLine(si, li, { kind: e.target.value })} className="min-w-[170px]">{KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select></td>
                      <td className="py-1 pr-2"><Input aria-label="Description" value={l.description} onChange={(e) => setLine(si, li, { description: e.target.value })} className="min-w-[220px]" /></td>
                      <td className="py-1 pr-2"><Input aria-label="Quantity" inputMode="decimal" value={l.kind === "MANIFEST_FEE" ? "1" : l.quantity} readOnly={l.kind === "MANIFEST_FEE"} onChange={(e) => setLine(si, li, { quantity: e.target.value })} className="w-24 text-right" /></td>
                      <td className="py-1 pr-2"><Input aria-label="Price" inputMode="decimal" value={l.kind === "MANIFEST_FEE" ? (priced[si]!.fee / 100).toFixed(2) : l.unitPrice} readOnly={l.kind === "MANIFEST_FEE"} onChange={(e) => setLine(si, li, { unitPrice: e.target.value })} placeholder={l.kind === "PER_GALLON" ? "0.42" : "225.00"} className="w-28 text-right" /></td>
                      <td className="py-1 text-right tabular-nums">{priced[si]!.lines[li] === null ? "—" : formatCents(priced[si]!.lines[li])}</td>
                      <td className="pl-1"><Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setSection(si, { lines: s.lines.filter((_, j) => j !== li) })}><Trash2 /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setSection(si, { lines: [...s.lines, blank("PER_GALLON", "Grease trap pumping & disposal")] })}><Plus /> Per-gallon pumping</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSection(si, { lines: [...s.lines, blank("FLAT_RATE", "Grease trap pumping & disposal")] })}><Plus /> Flat-rate service</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setSection(si, { lines: [...s.lines, blank("OTHER")] })}><Plus /> Extra</Button>
              {!s.lines.some((l) => l.kind === "MANIFEST_FEE") && <Button type="button" variant="ghost" size="sm" onClick={() => setSection(si, { lines: [...s.lines, { kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0" }] })}><Plus /> Manifest fee ({manifestFeeBps / 100}%)</Button>}
              {p.sections.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => set({ sections: p.sections.filter((_, j) => j !== si) })}><Trash2 /> Remove section</Button>}
              <span className="ml-auto text-sm text-muted-foreground">Section total <span className="font-medium tabular-nums text-foreground">{formatCents(priced[si]!.total)}</span></span>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" size="sm" onClick={() => set({ sections: [...p.sections, { title: "", subtotalLabel: "", lines: [blank()] }] })}><Plus /> Add a section (e.g. a second concept)</Button>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Note" name="note" className="sm:col-span-2"><Textarea rows={4} value={p.note} onChange={(e) => set({ note: e.target.value })} /></Field>
          <div className="space-y-3">
            <Field label="Price range instead of total (optional)" name="priceNote" hint="e.g. $3,537 – $3,897. Prints as the estimate."><Input value={p.priceNote} onChange={(e) => set({ priceNote: e.target.value })} /></Field>
            <div className="rounded-lg border bg-subtle/40 p-4 text-sm"><div className="flex justify-between font-semibold"><span>{word === "quote" ? "Quote" : "Proposal"} total</span><span className="tabular-nums">{p.priceNote || formatCents(total)}</span></div></div>
          </div>
        </div>
      </fieldset>
      {!locked && <SubmitButton>{p.id ? "Save changes" : `Create ${word}`}</SubmitButton>}
    </ActionForm>
  );
}
