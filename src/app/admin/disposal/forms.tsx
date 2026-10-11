"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Pencil, Plus } from "lucide-react";
import { recordDisposalAdminAction, saveFacilityAction } from "@/app/admin/_actions/ops";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function AdminDisposalForm({ vehicleId, drivers, facilities, loads, wasteTypes, now }: { vehicleId: string; drivers: { id: string; name: string }[]; facilities: { id: string; name: string }[]; loads: { id: string; jobNumber: string; location: string; gallons: number }[]; wasteTypes: string[]; now: string }) {
  const [sel, setSel] = React.useState(loads.map((l) => l.id));
  const total = loads.filter((l) => sel.includes(l.id)).reduce((s, l) => s + l.gallons, 0);
  return (
    <ActionForm action={recordDisposalAdminAction as Act} className="grid gap-4 sm:grid-cols-3" encType="multipart/form-data" resetOnSuccess>
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <Field label="Driver" name="driverId" required><Select>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Facility" name="facilityId" required><Select><option value="">Select…</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
      <Field label="Disposed at" name="disposedAt" required><Input type="datetime-local" defaultValue={now} /></Field>
      <fieldset className="space-y-1 sm:col-span-3">
        <legend className="text-[13px] font-medium">Loads ({total.toLocaleString()} gal selected)</legend>
        {loads.length === 0 && <p className="text-[13px] text-muted-foreground">No unallocated loads for this truck in the last 14 days.</p>}
        {loads.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><Checkbox name="jobIds[]" value={l.id} checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> {l.jobNumber} · {l.location} · {l.gallons.toLocaleString()} gal</label>)}
      </fieldset>
      <Field label="Waste type" name="wasteType" required><Select>{wasteTypes.map((w) => <option key={w}>{w}</option>)}</Select></Field>
      <Field label="Gallons disposed" name="gallons" required><Input inputMode="numeric" defaultValue={total || ""} key={total} /></Field>
      <Field label="Rate ($/gal)" name="ratePerGallon" hint="Blank = facility default"><Input inputMode="decimal" /></Field>
      <Field label="Opening load" name="openingLoadGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Closing load" name="closingLoadGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Ticket #" name="ticketNumber"><Input /></Field>
      <Field label="Adjustment (gal)" name="adjustmentGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Adjustment reason" name="adjustmentReason" className="sm:col-span-2"><Input /></Field>
      <Field label="Ticket / receipt" name="ticket" className="sm:col-span-2"><Input type="file" accept="image/*,application/pdf" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox name="facilityAcknowledged" /> Facility acknowledgment on ticket</label>
      <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea rows={2} /></Field>
      <div className="sm:col-span-3"><SubmitButton>Record disposal event</SubmitButton></div>
    </ActionForm>
  );
}

export function FacilityDialog({ facility, wasteTypes }: { facility?: { id: string; name: string; addressLine1: string; city: string; state: string; postalCode: string; phone: string | null; permitNumber: string | null; acceptedWasteTypes: string[]; rate: string | null; status: string; notes: string | null }; wasteTypes: string[] }) {
  return (
    <FormDialog trigger={<Button size="sm" variant={facility ? "ghost" : "primary"}>{facility ? <Pencil /> : <Plus />}{facility ? "Edit" : "Add facility"}</Button>} title={facility ? "Edit facility" : "Add disposal facility"} size="lg">
      {(close) => (
        <ActionForm action={saveFacilityAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={close}>
          {facility && <input type="hidden" name="facilityId" value={facility.id} />}
          <Field label="Name" name="name" required className="sm:col-span-2"><Input defaultValue={facility?.name} /></Field>
          <Field label="Address" name="addressLine1" required className="sm:col-span-2"><Input defaultValue={facility?.addressLine1} /></Field>
          <Field label="City" name="city" required><Input defaultValue={facility?.city} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="State" name="state" required><Input defaultValue={facility?.state ?? "TX"} maxLength={2} /></Field><Field label="ZIP" name="postalCode" required><Input defaultValue={facility?.postalCode} /></Field></div>
          <Field label="Phone" name="phone"><Input defaultValue={facility?.phone ?? ""} /></Field>
          <Field label="Permit #" name="permitNumber"><Input defaultValue={facility?.permitNumber ?? ""} /></Field>
          <Field label="Default rate ($/gal)" name="ratePerGallon"><Input inputMode="decimal" defaultValue={facility?.rate ?? ""} placeholder="0.065" /></Field>
          <Field label="Status" name="status"><Select defaultValue={facility?.status ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>
          <fieldset className="sm:col-span-2"><legend className="text-[13px] font-medium">Accepted waste types</legend><div className="mt-1 flex flex-wrap gap-3">{wasteTypes.map((w) => <label key={w} className="flex items-center gap-2 text-sm"><Checkbox name="acceptedWasteTypes[]" value={w} defaultChecked={facility?.acceptedWasteTypes.includes(w)} /> {w}</label>)}</div></fieldset>
          <Field label="Notes" name="notes" className="sm:col-span-2"><Textarea rows={2} defaultValue={facility?.notes ?? ""} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save facility</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
