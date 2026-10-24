"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, Loader2, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { compressImage } from "@/lib/offline-store";
import { cn } from "@/lib/utils";
import { saveExpenseAction } from "@/app/admin/_actions/expenses";

export type ExpenseRow = { id: string; date: string; category: string; amount: string; vendor: string | null; description: string; paidFrom: string; paidByUserId: string | null; paidByName: string | null; organizationId: string | null; notes: string | null };

type Opts = { categories: { value: string; label: string }[]; paidFrom: { value: string; label: string }[]; staff: { id: string; name: string }[]; customers: { id: string; name: string }[]; today: string; me: string };

function F({ label, error, children, className, hint }: { label: string; error?: string; children: React.ReactNode; className?: string; hint?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-[12px] text-danger">{error}</p> : hint ? <p className="text-[12px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Add / edit dialog for an external cost, with a receipt photo shrunk on the phone before upload. */
export function ExpenseDialog({ opts, expense }: { opts: Opts; expense?: ExpenseRow }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [errors, setErrors] = React.useState<Record<string, string[] | undefined>>({});
  const [paidFrom, setPaidFrom] = React.useState(expense?.paidFrom ?? "BUSINESS_ACCOUNT");
  const [receipt, setReceipt] = React.useState<File | null>(null);
  const err = (k: string) => errors[k]?.[0];

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    start(async () => {
      fd.delete("receipt");
      if (receipt) {
        const blob = receipt.type.startsWith("image/") ? await compressImage(receipt) : receipt;
        fd.set("receipt", blob, blob === receipt ? receipt.name : receipt.name.replace(/\.\w+$/, "") + ".jpg");
      }
      const res = await saveExpenseAction(fd);
      if (res.ok) {
        toast.success(expense ? "Cost updated." : "Cost added.");
        setOpen(false);
        setReceipt(null);
        setErrors({});
        router.refresh();
      } else {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !pending && setOpen(o)}>
      {expense ? (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Edit cost"><Pencil /></Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> Add cost</Button>
      )}
      <DialogContent title={expense ? "Edit cost" : "Add a cost"} description="Gas, contractors, tools, permits — anything the business paid for besides disposal-site bills." size="lg">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
          {expense && <input type="hidden" name="expenseId" value={expense.id} />}
          <F label="Amount ($)" error={err("amount")}><Input name="amount" inputMode="decimal" defaultValue={expense?.amount ?? ""} placeholder="64.25" className="h-11 text-[16px]" autoFocus /></F>
          <F label="Date" error={err("date")}><Input name="date" type="date" defaultValue={expense?.date ?? opts.today} className="h-11" /></F>
          <F label="Category"><Select name="category" defaultValue={expense?.category ?? "FUEL"}>{opts.categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></F>
          <F label="Paid to" hint="Gas station, contractor, store…"><Input name="vendor" defaultValue={expense?.vendor ?? ""} /></F>
          <F label="What was it for?" error={err("description")} className="sm:col-span-2"><Input name="description" defaultValue={expense?.description ?? ""} placeholder="e.g. Diesel for the truck, plumber for Willies job" /></F>

          <F label="Paid from"><Select name="paidFrom" value={paidFrom} onChange={(e) => setPaidFrom(e.target.value)}>{opts.paidFrom.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></F>
          {paidFrom === "PERSONAL" ? (
            <F label="Whose money?" error={err("paidByUserId")} hint="Tracked as owed back until marked reimbursed.">
              <Select name="paidByUserId" defaultValue={expense?.paidByUserId ?? opts.me}>{opts.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
            </F>
          ) : <div className="hidden sm:block" />}

          <F label="For a customer (optional)" hint="e.g. a contractor you paid for a plumbing job."><Select name="organizationId" defaultValue={expense?.organizationId ?? ""}><option value="">— Not for a specific customer —</option>{opts.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></F>
          <F label="Receipt (optional)">
            <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-dashed border-input px-3 text-[14px] text-muted-foreground hover:bg-subtle">
              <Camera className="h-4 w-4" /><span className="truncate">{receipt ? receipt.name : expense ? "Add another photo or PDF" : "Take a photo or choose a file"}</span>
              <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={(e) => setReceipt(e.target.files?.[0] ?? null)} />
            </label>
          </F>
          <F label="Notes (optional)" className="sm:col-span-2"><Textarea name="notes" rows={2} defaultValue={expense?.notes ?? ""} /></F>
          <div className="flex gap-2 sm:col-span-2">
            <Button type="submit" className="h-11 flex-1 sm:flex-none sm:px-8" disabled={pending}>{pending ? <><Loader2 className="animate-spin" /> Saving…</> : expense ? "Save changes" : "Add cost"}</Button>
            <Button type="button" variant="secondary" className="h-11" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
