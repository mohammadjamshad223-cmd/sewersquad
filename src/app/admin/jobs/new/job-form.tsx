"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { SERVICE_TYPE_LABEL } from "@/lib/status";
import { createJobAction } from "@/app/admin/_actions/ops";

type Loc = { id: string; label: string; windowStart: string | null; windowEnd: string | null; assets: { id: string; label: string; capacity: number }[] };

export function JobForm({ locations, drivers, vehicles, defaultLocationId, today }: { locations: Loc[]; drivers: { id: string; name: string; vehicleId: string | null }[]; vehicles: { id: string; unitNumber: string }[]; defaultLocationId?: string; today: string }) {
  const [locId, setLocId] = React.useState(defaultLocationId ?? "");
  const [driverId, setDriverId] = React.useState("");
  const loc = locations.find((l) => l.id === locId);
  return (
    <ActionForm action={createJobAction as (s: ActionState, fd: FormData) => Promise<ActionState>} className="grid gap-4 sm:grid-cols-2" refresh={false}>
      <Field label="Location" name="locationId" required className="sm:col-span-2">
        <Select value={locId} onChange={(e) => setLocId(e.target.value)}><option value="">Select a location…</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</Select>
      </Field>
      <Field label="Service type" name="serviceType" required><Select defaultValue="INTERCEPTOR_PUMPING">{Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Job type" name="type"><Select defaultValue="ONE_TIME"><option value="ONE_TIME">One-time</option><option value="EMERGENCY">Emergency</option></Select></Field>
      <Field label="Date" name="scheduledDate" required><Input type="date" defaultValue={today} /></Field>
      <Field label="Priority" name="priority"><Select defaultValue="NORMAL"><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="EMERGENCY">Emergency</option></Select></Field>
      <Field label="Window start" name="windowStart"><Input type="time" defaultValue={loc?.windowStart ?? ""} key={`ws-${locId}`} /></Field>
      <Field label="Window end" name="windowEnd"><Input type="time" defaultValue={loc?.windowEnd ?? ""} key={`we-${locId}`} /></Field>
      {loc && (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-[13px] font-medium">Equipment</legend>
          <div className="flex flex-wrap gap-4">{loc.assets.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox name="assetIds[]" value={a.id} defaultChecked /> {a.label}</label>)}</div>
        </fieldset>
      )}
      <Field label="Estimated gallons" name="estimatedGallons" hint="Defaults to the equipment capacity."><Input inputMode="numeric" /></Field>
      <Field label="Quoted price ($)" name="quotedPrice" hint="Only if confirmed with the customer."><Input inputMode="decimal" /></Field>
      <Field label="Driver" name="driverId"><Select value={driverId} onChange={(e) => setDriverId(e.target.value)}><option value="">Assign later</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Truck" name="vehicleId"><Select defaultValue={drivers.find((d) => d.id === driverId)?.vehicleId ?? ""} key={driverId}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
      <Field label="Instructions for the driver" name="instructions" className="sm:col-span-2"><Textarea rows={3} /></Field>
      <Field label="Internal notes" name="internalNotes" className="sm:col-span-2" hint="Office only — never shown to drivers or customers."><Textarea rows={2} /></Field>
      <div className="sm:col-span-2"><SubmitButton>Create job</SubmitButton></div>
    </ActionForm>
  );
}
