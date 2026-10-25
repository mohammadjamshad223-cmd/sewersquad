"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setInvoiceDisposalCostAction } from "@/app/admin/_actions/billing";

/** Set what dumping this invoice's waste cost us (internal; feeds profit only). */
export function DisposalCostForm({ invoiceId, current, averageCents }: { invoiceId: string; current: string | null; averageCents: number | null }) {
  const router = useRouter();
  const [value, setValue] = React.useState(current ?? "");
  const [pending, start] = React.useTransition();
  const save = (v: string | null) =>
    start(async () => {
      const res = await setInvoiceDisposalCostAction(invoiceId, v);
      if (!res.ok) return void toast.error(res.error);
      toast.success(v === null ? "Disposal cost cleared — using the average." : "Disposal cost saved.");
      router.refresh();
    });
  const avg = averageCents !== null ? Math.round(averageCents * 10) / 10 : null;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-[13px] font-medium">
        <span>¢ per gallon</span>
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={avg !== null ? String(avg) : "17"} className="w-28" />
      </label>
      <Button size="sm" disabled={pending || value.trim() === ""} onClick={() => save(value.trim())}>Save</Button>
      <Button size="sm" variant="secondary" disabled={pending} onClick={() => { setValue("0"); save("0"); }}>0¢ — nothing dumped</Button>
      {current !== null && <Button size="sm" variant="ghost" disabled={pending} onClick={() => { setValue(""); save(null); }}>Use average</Button>}
    </div>
  );
}
