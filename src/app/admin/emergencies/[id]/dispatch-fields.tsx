"use client";

import * as React from "react";
import { Field } from "@/components/ui/form";
import { Checkbox, Input, Select } from "@/components/ui/input";

export function DispatchFields({ drivers, vehicles, assets, today }: { drivers: { id: string; name: string; vehicleId: string | null }[]; vehicles: { id: string; unitNumber: string }[]; assets: { id: string; label: string }[]; today: string }) {
  const [driver, setDriver] = React.useState("");
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Driver" name="driverId" required><Select value={driver} onChange={(e) => setDriver(e.target.value)}><option value="">Select…</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Truck" name="vehicleId" required><Select key={driver} defaultValue={drivers.find((d) => d.id === driver)?.vehicleId ?? ""}><option value="">Select…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Field label="Date" name="scheduledDate"><Input type="date" defaultValue={today} /></Field>
        <Field label="From" name="windowStart"><Input type="time" /></Field>
        <Field label="To" name="windowEnd"><Input type="time" /></Field>
      </div>
      <fieldset><legend className="text-[13px] font-medium">Equipment</legend><div className="mt-1 flex flex-wrap gap-3">{assets.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox name="assetIds[]" value={a.id} defaultChecked /> {a.label}</label>)}</div></fieldset>
    </div>
  );
}
