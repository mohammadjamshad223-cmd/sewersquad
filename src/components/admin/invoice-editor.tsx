"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LINE_ITEM_KIND_LABEL } from "@/lib/status";
import { computeInvoiceTotals } from "@/domain/invoice-math";
import { formatCents, parseDollarRateToCentsString } from "@/lib/money";
import { manifestFeeCents } from "@/domain/document-lines";
import { lineAmountCents } from "@/domain/invoice-math";
import { confirmJobInvoiceAction, createInvoiceAction, updateInvoiceAction } from "@/app/admin/_actions/billing";

type Line = { kind: string; description: string; quantity: string; unitPrice: string; taxable: boolean };
type Org = { id: string; name: string; locations: { id: string; name: string }[]; billingProfiles: { id: string; name: string }[] };

/** Line-item editor with a live preview computed by the same exact integer math the server uses. */
const SERVICE_TITLES = ["Grease Trap Pumping & Disposal", "Grit Trap Pumping & Disposal", "Grease Trap Cleaning", "Lift Station Service", "Hydro Jetting", "Line Snaking, Jetting & Inspection"];

/**
 * `confirmJob`: the operator is confirming a completed job's invoice. Customer and location are
 * fixed, and submitting creates the invoice, sends it, and sends the customer their paperwork.
 */
/** Internal disposal cost for this invoice: default rate (cents/gal), the average from disposal bills, and the job's gallons. */
type DisposalInit = { defaultCents: string; averageCents: number | null; gallons: number | null; hauls: boolean };

export function InvoiceEditor({ orgs, invoice, taxRateBps, manifestFeeBps = 400, confirmJob, disposal }: { orgs: Org[]; taxRateBps: number; manifestFeeBps?: number; disposal?: DisposalInit; confirmJob?: { jobId: string; locationId: string; locationName: string; redirectTo: string }; invoice?: { id: string; organizationId: string; serviceLocationId: string | null; billingProfileId: string | null; serviceDate: string | null; paymentTermsDays: number; poNumber: string | null; serviceTitle?: string | null; nextServiceDate?: string | null; notes: string | null; lines: Line[] } }) {
  const [orgId, setOrgId] = React.useState(invoice?.organizationId ?? "");
  const [disposalCents, setDisposalCents] = React.useState(disposal?.defaultCents ?? "");
  const [lines, setLines] = React.useState<Line[]>(invoice?.lines ?? [{ kind: "SERVICE", description: "", quantity: "1", unitPrice: "", taxable: true }]);
  const org = orgs.find((o) => o.id === orgId);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  // Manifest fee lines mirror the server: a percentage of the trap service lines.
  const priced = (l: Line) => /^\d+(\.\d{1,3})?$/.test(l.quantity) && parseDollarRateToCentsString(l.unitPrice) !== null;
  const feeCents = manifestFeeCents(lines.filter((l) => l.kind !== "MANIFEST_FEE" && priced(l)).map((l) => ({ kind: l.kind, amountCents: lineAmountCents(l.quantity, parseDollarRateToCentsString(l.unitPrice)!) })), manifestFeeBps);
  const shown = lines.map((l) => (l.kind === "MANIFEST_FEE" ? { ...l, quantity: "1", unitPrice: (feeCents / 100).toFixed(2) } : l));
  let preview: ReturnType<typeof computeInvoiceTotals> | null = null;
  let previewError: string | null = null;
  try {
    const valid = shown.filter((l) => l.unitPrice !== "" && /^\d+(\.\d{1,3})?$/.test(l.quantity) && parseDollarRateToCentsString(l.unitPrice) !== null);
    preview = computeInvoiceTotals(valid.map((l) => ({ kind: l.kind, quantity: l.quantity, unitPriceCents: parseDollarRateToCentsString(l.unitPrice)!, taxable: l.taxable })), taxRateBps);
  } catch (e) {
    previewError = e instanceof Error ? e.message : "Invalid lines";
  }
  return (
    <ActionForm action={(confirmJob ? confirmJobInvoiceAction : invoice ? updateInvoiceAction : createInvoiceAction) as (s: ActionState, fd: FormData) => Promise<ActionState>} className="space-y-6" refresh={!!invoice} redirectTo={confirmJob?.redirectTo}>
      {invoice && !confirmJob && <input type="hidden" name="invoiceId" value={invoice.id} />}
      {confirmJob && <input type="hidden" name="jobId" value={confirmJob.jobId} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Customer" name="organizationId" required>
          {invoice || confirmJob ? <Select value={orgId} disabled><option value={orgId}>{org?.name}</option></Select> : <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}><option value="">Select…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
        </Field>
        {(invoice || confirmJob) && <input type="hidden" name="organizationId" value={orgId} />}
        {confirmJob ? (
          <>
            <Field label="Service location" name="_location"><Select value={confirmJob.locationId} disabled><option value={confirmJob.locationId}>{confirmJob.locationName}</option></Select></Field>
            <input type="hidden" name="serviceLocationId" value={confirmJob.locationId} />
          </>
        ) : (
          <Field label="Service location" name="serviceLocationId" hint="Blank = account-level (consolidated) invoice."><Select defaultValue={invoice?.serviceLocationId ?? ""} key={`l-${orgId}`}><option value="">Account level</option>{org?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        )}
        <Field label="Billing profile" name="billingProfileId"><Select defaultValue={invoice?.billingProfileId ?? ""} key={`b-${orgId}`}><option value="">Default</option>{org?.billingProfiles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Service date" name="serviceDate"><Input type="date" defaultValue={invoice?.serviceDate ?? ""} /></Field>
        <Field label="Payment terms (days)" name="paymentTermsDays" hint="Blank = billing profile terms."><Input inputMode="numeric" defaultValue={invoice?.paymentTermsDays ?? ""} /></Field>
        <Field label="PO number" name="poNumber"><Input defaultValue={invoice?.poNumber ?? ""} /></Field>
        <Field label="Service (printed under SERVICE)" name="serviceTitle" className="sm:col-span-2"><Input list="service-titles" defaultValue={invoice?.serviceTitle ?? ""} placeholder="Grease Trap Pumping & Disposal" /></Field>
        <datalist id="service-titles">{SERVICE_TITLES.map((t) => <option key={t} value={t} />)}</datalist>
        <Field label="Next service date" name="nextServiceDate" hint="Printed on the invoice."><Input type="date" defaultValue={invoice?.nextServiceDate ?? ""} /></Field>
      </div>
      <div className="space-y-2">
        <div className="hidden grid-cols-[150px_minmax(0,1fr)_90px_110px_76px_96px_36px] gap-2 px-1 text-[12px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
          <span>Type</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Unit price ($)</span><span>Taxable</span><span className="text-right">Amount</span><span />
        </div>
        {shown.map((l, i) => (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-3 md:grid-cols-[150px_minmax(0,1fr)_90px_110px_76px_96px_36px] md:items-center md:border-0 md:p-0">
            <Select name="kind" aria-label="Line type" value={l.kind} onChange={(e) => set(i, { kind: e.target.value })} className="col-span-2 md:col-span-1">{Object.entries(LINE_ITEM_KIND_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select>
            <Input name="description" aria-label="Description" placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="col-span-2 md:col-span-1" />
            <label className="text-[12px] text-muted-foreground md:contents"><span className="md:hidden">Qty</span><Input name="quantity" aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="text-right" /></label>
            <label className="text-[12px] text-muted-foreground md:contents"><span className="md:hidden">Unit price ($)</span><Input name="unitPrice" aria-label="Unit price" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} className={`text-right ${l.unitPrice === "" ? "border-warning" : ""}`} placeholder="0.00" readOnly={l.kind === "MANIFEST_FEE"} title={l.kind === "MANIFEST_FEE" ? `${manifestFeeBps / 100}% of the trap service lines` : undefined} /></label>
            <Select name="taxable" aria-label="Taxable" value={l.taxable ? "yes" : "no"} onChange={(e) => set(i, { taxable: e.target.value === "yes" })}><option value="yes">Taxable</option><option value="no">No tax</option></Select>
            <span className="self-center text-right text-[14px] font-medium tabular-nums">{preview && l.unitPrice && previewError === null ? formatCents(preview.lines[shown.filter((x) => x.unitPrice !== "").indexOf(l)]?.amountCents ?? 0) : "—"}</span>
            <Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1} className="col-span-2 justify-self-end md:col-span-1"><Trash2 /></Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { kind: "SERVICE", description: "", quantity: "1", unitPrice: "", taxable: true }])}><Plus /> Add line</Button>
        {!lines.some((l) => l.kind === "MANIFEST_FEE") && (
          <>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { kind: "MANIFEST_FEE", description: "City of Houston manifest fee", quantity: "1", unitPrice: "0", taxable: false }])}><Plus /> City of Houston manifest fee ({manifestFeeBps / 100}%)</Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { kind: "MANIFEST_FEE", description: "Manifest fee", quantity: "1", unitPrice: "0", taxable: false }])}><Plus /> Manifest fee ({manifestFeeBps / 100}%)</Button>
          </>
        )}
      </div>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <Field label="Note (shown on invoice)" name="notes" className="flex-1" hint="Leave blank to write it automatically, e.g. “Service billed at $0.89 per gallon for 750 gallons pumped…”"><Textarea rows={3} defaultValue={invoice?.notes ?? ""} /></Field>
        <div className="w-full max-w-xs space-y-1.5 rounded-lg border bg-subtle/40 p-4 text-sm">
          {previewError ? <p className="text-danger">{previewError}</p> : preview && (
            <>
              <Row l="Subtotal" v={formatCents(preview.subtotalCents)} />
              {preview.discountCents > 0 && <Row l="Discounts" v={`−${formatCents(preview.discountCents)}`} />}
              <Row l={`Tax (${(taxRateBps / 100).toFixed(2)}%)`} v={formatCents(preview.taxCents)} />
              <Row l="Total" v={formatCents(preview.totalCents)} strong />
              <p className="pt-1 text-[11px] text-muted-foreground">Preview at the company default tax rate; the customer&apos;s billing profile rate applies on save.</p>
            </>
          )}
        </div>
      </div>
      {disposal && (() => {
        const gallons = disposal.gallons ?? Math.round(lines.filter((l) => l.kind === "PER_GALLON").reduce((s, l) => s + (Number(l.quantity) || 0), 0));
        const rate = disposalCents === "" ? null : Number(disposalCents);
        const cost = rate !== null && Number.isFinite(rate) ? Math.round(gallons * rate) : null;
        const avg = disposal.averageCents !== null ? Math.round(disposal.averageCents * 10) / 10 : null;
        return (
          <div className="space-y-2 rounded-lg border border-dashed p-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="space-y-1.5 text-[13px] font-medium">
                <span>Disposal cost for this job (¢ per gallon)</span>
                <Input name="disposalCentsPerGallon" inputMode="decimal" value={disposalCents} onChange={(e) => setDisposalCents(e.target.value)} placeholder={avg !== null ? `${avg}` : "e.g. 17"} className="h-11 w-40 text-[16px]" />
              </label>
              <Button type="button" variant="secondary" size="sm" className="h-9" onClick={() => setDisposalCents("0")}>0¢ — nothing to dump</Button>
              {avg !== null && <Button type="button" variant="ghost" size="sm" className="h-9" onClick={() => setDisposalCents(String(avg))}>Average {avg}¢</Button>}
            </div>
            <p className="text-[13px] text-muted-foreground">
              {!disposal.hauls ? "Nothing is hauled on this kind of job, so it's 0. " : ""}
              {cost !== null ? `≈ ${formatCents(cost)} to dump ${gallons.toLocaleString()} gal` : avg !== null ? `Blank uses your average of ${avg}¢ per gallon` : "Blank = not counted"}
              {cost !== null && preview && !previewError ? ` · profit on this job ≈ ${formatCents(preview.subtotalCents - preview.discountCents - cost)}` : ""}. Internal only — never printed on the invoice. Use 0 for waste water.
            </p>
          </div>
        );
      })()}
      {invoice && !confirmJob && <Field label="Reason for change (audit log)" name="reason"><Input /></Field>}
      {confirmJob ? (
        <div className="space-y-2 rounded-lg border border-brand/20 bg-brand-soft/40 p-4">
          <p className="text-[14px]">Check the price per gallon, gallons and any extra lines. When you confirm, the invoice{preview && !previewError ? ` for ${formatCents(preview.totalCents)}` : ""} is sent and the customer gets it with the manifest and photos by email and text.</p>
          <SubmitButton pendingText="Sending…" className="h-11 w-full text-[15px] sm:w-auto sm:px-8">Confirm & send invoice{preview && !previewError ? ` — ${formatCents(preview.totalCents)}` : ""}</SubmitButton>
        </div>
      ) : (
        <SubmitButton>{invoice ? "Save draft" : "Create draft invoice"}</SubmitButton>
      )}
    </ActionForm>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "border-t pt-1.5 font-semibold" : "text-muted-foreground"}`}><span>{l}</span><span className="tabular-nums text-foreground">{v}</span></div>;
}
