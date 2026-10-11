"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { formatCents } from "@/lib/money";
import { recordPaymentAction } from "@/app/admin/_actions/billing";

export function RecordPaymentForm({ orgs, orgId, invoices, preselect }: { orgs: { id: string; name: string }[]; orgId: string | null; invoices: { id: string; invoiceNumber: string; dueDate: string; balanceCents: number }[]; preselect: string | null }) {
  const router = useRouter();
  const [sel, setSel] = React.useState<string[]>(preselect ? [preselect] : []);
  const total = invoices.filter((i) => sel.includes(i.id)).reduce((s, i) => s + i.balanceCents, 0);
  return (
    <div className="space-y-6">
      <Field label="Customer" name="_org"><Select value={orgId ?? ""} onChange={(e) => router.push(`/admin/payments/new?org=${e.target.value}`)}><option value="">Select…</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
      {orgId && (
        <ActionForm action={recordPaymentAction as (s: ActionState, fd: FormData) => Promise<ActionState>} className="grid gap-4 sm:grid-cols-3" refresh={false}>
          <input type="hidden" name="organizationId" value={orgId} />
          <fieldset className="space-y-1 sm:col-span-3">
            <legend className="text-[13px] font-medium">Apply to invoices (oldest first)</legend>
            {invoices.length === 0 && <p className="text-[13px] text-muted-foreground">No open invoices for this customer.</p>}
            {invoices.map((i) => <label key={i.id} className="flex items-center gap-2 text-sm"><Checkbox name="invoiceIds[]" value={i.id} checked={sel.includes(i.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, i.id] : s.filter((x) => x !== i.id)))} /> {i.invoiceNumber} · due {i.dueDate} · {formatCents(i.balanceCents)}</label>)}
          </fieldset>
          <Field label="Method" name="method" required><Select><option value="CHECK">Check</option><option value="CASH">Cash</option><option value="OTHER">Other</option></Select></Field>
          <Field label="Amount ($)" name="amount" required hint={`Selected balance ${formatCents(total)}`}><Input inputMode="decimal" key={total} defaultValue={total ? (total / 100).toFixed(2) : ""} /></Field>
          <Field label="Reference (check #)" name="reference"><Input /></Field>
          <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea rows={2} /></Field>
          <div className="sm:col-span-3"><SubmitButton>Record payment</SubmitButton></div>
        </ActionForm>
      )}
    </div>
  );
}
