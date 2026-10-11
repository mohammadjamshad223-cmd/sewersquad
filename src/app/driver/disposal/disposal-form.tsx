"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea, Checkbox } from "@/components/ui/input";
import { recordDisposalAction } from "../actions";

type Load = { id: string; jobNumber: string; location: string; gallons: number };

export function DisposalForm({ vehicles, defaultVehicleId, facilities, loads, wasteTypes, now }: { vehicles: { id: string; unitNumber: string }[]; defaultVehicleId: string | null; facilities: { id: string; name: string; rate: string | null }[]; loads: Load[]; wasteTypes: string[]; now: string }) {
  const [selected, setSelected] = React.useState<string[]>(loads.map((l) => l.id));
  const collected = loads.filter((l) => selected.includes(l.id)).reduce((s, l) => s + l.gallons, 0);
  return (
    <ActionForm action={recordDisposalAction} className="space-y-4" encType="multipart/form-data" resetOnSuccess>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Truck" name="vehicleId" required><Select defaultValue={defaultVehicleId ?? ""} className="h-12">{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
        <Field label="Waste type" name="wasteType" required><Select className="h-12">{wasteTypes.map((w) => <option key={w}>{w}</option>)}</Select></Field>
      </div>
      <Field label="Disposal facility" name="facilityId" required><Select className="h-12"><option value="">Select…</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
      <Field label="Date & time" name="disposedAt" required><Input type="datetime-local" defaultValue={now} className="h-12" /></Field>
      <div className="rounded-xl border bg-surface p-4">
        <p className="text-[15px] font-medium">Loads in this discharge</p>
        {loads.length === 0 && <p className="text-[13px] text-muted-foreground">No unallocated loads on this truck.</p>}
        {loads.map((l) => (
          <label key={l.id} className="flex min-h-12 items-center gap-3 text-[14px]">
            <Checkbox name="jobIds[]" value={l.id} checked={selected.includes(l.id)} onChange={(e) => setSelected((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} className="h-5 w-5" />
            <span className="flex-1">{l.location} <span className="text-muted-foreground">· {l.jobNumber}</span></span>
            <span className="tabular-nums">{l.gallons.toLocaleString()} gal</span>
          </label>
        ))}
        <p className="mt-2 text-[13px] text-muted-foreground">Collected in selected loads: <span className="font-semibold text-foreground">{collected.toLocaleString()} gal</span></p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Gallons disposed" name="gallons" required><Input inputMode="numeric" defaultValue={collected || ""} key={collected} className="h-12" /></Field>
        <Field label="Opening load" name="openingLoadGallons" hint="Before these loads"><Input inputMode="numeric" defaultValue="0" className="h-12" /></Field>
        <Field label="Left in tank" name="closingLoadGallons"><Input inputMode="numeric" defaultValue="0" className="h-12" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Adjustment (gal)" name="adjustmentGallons" hint="Documented +/- only"><Input inputMode="numeric" defaultValue="0" className="h-12" /></Field>
        <Field label="Adjustment reason" name="adjustmentReason"><Input className="h-12" /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Ticket / reference #" name="ticketNumber"><Input className="h-12" /></Field>
        <Field label="Rate per gallon ($)" name="ratePerGallon" hint="Blank = facility default"><Input inputMode="decimal" className="h-12" /></Field>
      </div>
      <Field label="Disposal ticket photo / PDF" name="ticket"><Input type="file" accept="image/*,application/pdf" capture="environment" /></Field>
      <label className="flex items-center gap-3 text-[14px]"><Checkbox name="facilityAcknowledged" className="h-5 w-5" /> Facility acknowledgment is on the ticket</label>
      <Field label="Notes" name="notes"><Textarea rows={2} /></Field>
      <SubmitButton size="xl" className="w-full" pendingText="Saving…">Record disposal</SubmitButton>
    </ActionForm>
  );
}
