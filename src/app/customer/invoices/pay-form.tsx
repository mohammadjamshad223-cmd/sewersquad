"use client";

import * as React from "react";
import { CreditCard } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { payInvoicesAction } from "../actions";

/** Wraps a table of selectable invoices and submits them to Stripe Checkout. */
export function PayForm({ children, disabled, notice }: { children: React.ReactNode; disabled?: boolean; notice?: string }) {
  return (
    <ActionForm action={payInvoicesAction} refresh={false}>
      {children}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <p className="text-[12px] text-muted-foreground">{notice ?? "Payments are processed securely by Stripe. Your invoice updates once the payment is confirmed."}</p>
        <SubmitButton disabled={disabled} pendingText="Opening secure checkout…"><CreditCard /> Pay selected</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function PaySingle({ invoiceId, balance, allowPartial, disabled }: { invoiceId: string; balance: string; allowPartial: boolean; disabled?: boolean }) {
  const [partial, setPartial] = React.useState(false);
  return (
    <ActionForm action={payInvoicesAction} refresh={false} className="space-y-3">
      <input type="hidden" name="invoiceIds[]" value={invoiceId} />
      {allowPartial && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} className="h-4 w-4 accent-[hsl(var(--brand))]" /> Pay a partial amount
        </label>
      )}
      {partial && (
        <Field label="Amount (USD)" name="amount" hint={`Up to $${balance}`}>
          <Input inputMode="decimal" placeholder="0.00" />
        </Field>
      )}
      <SubmitButton className="w-full" size="lg" disabled={disabled} pendingText="Opening secure checkout…"><CreditCard /> {partial ? "Pay amount" : `Pay $${balance}`}</SubmitButton>
    </ActionForm>
  );
}
