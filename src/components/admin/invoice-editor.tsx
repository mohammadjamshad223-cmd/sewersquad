"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { LINE_ITEM_KIND_LABEL } from "@/lib/status";
import { computeInvoiceTotals } from "@/domain/invoice-math";
import { formatCents, parseDollarRateToCentsString } from "@/lib/money";
import { createInvoiceAction, updateInvoiceAction } from "@/app/admin/_actions/billing";

type Line = { kind: string; description: string; quantity: string; unitPrice: string; taxable: boolean };
type Org = { id: string; name: string; locations: { id: string; name: string }[]; billingProfiles: { id: string; name: string }[] };

/** Line-item editor with a live preview computed by the same exact integer math the server uses. */
export function InvoiceEditor({ orgs, invoice, taxRateBps }: { orgs: Org[]; taxRateBps: number; invoice?: { id: string; organizationId: string; serviceLocationId: string | null; billingProfileId: string | null; serviceDate: string | null; paymentTermsDays: number; poNumber: string | null; notes: string | null; lines: Line[] } }) {
  const [orgId, setOrgId] = React.useState(invoice?.organizationId ?? "");
  const [lines, setLines] = React.useState<Line[]>(invoice?.lines ?? [{ kind: "SERVICE", description: "", quantity: "1", unitPrice: "", taxable: true }]);
  const org = orgs.find((o) => o.id === orgId);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  let preview: ReturnType<typeof computeInvoiceTotals> | null = null;
  let previewError: string | null = null;
  try {
    const valid = lines.filter((l) => l.unitPrice !== "" && /^\d+(\.\d{1,3})?$/.test(l.quantity) && parseDollarRateToCentsString(l.unitPrice) !== null);
    preview = computeInvoiceTotals(valid.map((l) => ({ kind: l.kind, quantity: l.quantity, unitPriceCents: parseDollarRateToCentsString(l.unitPrice)!, taxable: l.taxable })), taxRateBps);
  } catch (e) {
    previewError = e instanceof Error ? e.message : "Invalid lines";
  }
  return (
    <ActionForm action={(invoice ? updateInvoiceAction : createInvoiceAction) as (s: ActionState, fd: FormData) => Promise<ActionState>} className="space-y-6" refresh={!!invoice}>
      {invoice && <input type="hidden" name="invoiceId" value={invoice.id} />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Customer" name="organizationId" required>
          {invoice ? <Select value={orgId} disabled><option value={orgId}>{org?.name}</option></Select> : <Select value={orgId} onChange={(e) => setOrgId(e.target.value)}><option value="">Select…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select>}
        </Field>
        {invoice && <input type="hidden" name="organizationId" value={orgId} />}
        <Field label="Service location" name="serviceLocationId" hint="Blank = account-level (consolidated) invoice."><Select defaultValue={invoice?.serviceLocationId ?? ""} key={`l-${orgId}`}><option value="">Account level</option>{org?.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Billing profile" name="billingProfileId"><Select defaultValue={invoice?.billingProfileId ?? ""} key={`b-${orgId}`}><option value="">Default</option>{org?.billingProfiles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Service date" name="serviceDate"><Input type="date" defaultValue={invoice?.serviceDate ?? ""} /></Field>
        <Field label="Payment terms (days)" name="paymentTermsDays" hint="Blank = billing profile terms."><Input inputMode="numeric" defaultValue={invoice?.paymentTermsDays ?? ""} /></Field>
        <Field label="PO number" name="poNumber"><Input defaultValue={invoice?.poNumber ?? ""} /></Field>
      </div>
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-subtle/60 text-left text-[12px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-3 py-2">Type</th><th className="px-3 py-2">Description</th><th className="px-3 py-2 text-right">Qty</th><th className="px-3 py-2 text-right">Unit price ($)</th><th className="px-3 py-2">Taxable</th><th className="px-3 py-2 text-right">Amount</th><th /></tr></thead>
          <tbody className="divide-y">
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="px-2 py-2"><Select name="kind" aria-label="Line type" value={l.kind} onChange={(e) => set(i, { kind: e.target.value })} className="min-w-[150px]">{Object.entries(LINE_ITEM_KIND_LABEL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</Select></td>
                <td className="px-2 py-2"><Input name="description" aria-label="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} className="min-w-[240px]" /></td>
                <td className="px-2 py-2"><Input name="quantity" aria-label="Quantity" inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} className="w-24 text-right" /></td>
                <td className="px-2 py-2"><Input name="unitPrice" aria-label="Unit price" inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} className="w-28 text-right" placeholder="0.00" /></td>
                <td className="px-2 py-2"><Select name="taxable" aria-label="Taxable" value={l.taxable ? "yes" : "no"} onChange={(e) => set(i, { taxable: e.target.value === "yes" })} className="w-20"><option value="yes">Yes</option><option value="no">No</option></Select></td>
                <td className="px-3 py-2 text-right tabular-nums">{preview && l.unitPrice && previewError === null ? formatCents(preview.lines[lines.filter((x) => x.unitPrice !== "").indexOf(l)]?.amountCents ?? 0) : "—"}</td>
                <td className="px-2"><Button type="button" variant="ghost" size="icon" aria-label="Remove line" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} disabled={lines.length === 1}><Trash2 /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, { kind: "SERVICE", description: "", quantity: "1", unitPrice: "", taxable: true }])}><Plus /> Add line</Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <Field label="Notes (shown on invoice)" name="notes" className="flex-1"><Textarea rows={3} defaultValue={invoice?.notes ?? ""} /></Field>
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
      {invoice && <Field label="Reason for change (audit log)" name="reason"><Input /></Field>}
      <SubmitButton>{invoice ? "Save draft" : "Create draft invoice"}</SubmitButton>
    </ActionForm>
  );
}

function Row({ l, v, strong }: { l: string; v: string; strong?: boolean }) {
  return <div className={`flex justify-between ${strong ? "border-t pt-1.5 font-semibold" : "text-muted-foreground"}`}><span>{l}</span><span className="tabular-nums text-foreground">{v}</span></div>;
}
