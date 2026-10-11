"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { submitInspectionAction } from "../actions";

export function InspectionForm({ vehicles, defaultVehicleId, items, driverName }: { vehicles: { id: string; unitNumber: string }[]; defaultVehicleId: string | null; items: { key: string; label: string }[]; driverName: string }) {
  const [results, setResults] = React.useState<Record<string, "PASS" | "FAIL" | "NA">>(() => Object.fromEntries(items.map((i) => [i.key, "PASS"])));
  return (
    <ActionForm action={submitInspectionAction} className="space-y-4" encType="multipart/form-data" resetOnSuccess onSuccess={() => setResults(Object.fromEntries(items.map((i) => [i.key, "PASS"])))}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Truck" name="vehicleId" required><Select defaultValue={defaultVehicleId ?? ""} className="h-12"><option value="">Select…</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
        <Field label="Inspection" name="type" required><Select defaultValue="PRE_TRIP" className="h-12"><option value="PRE_TRIP">Pre-trip</option><option value="POST_TRIP">Post-trip</option></Select></Field>
      </div>
      <Field label="Odometer" name="odometer"><Input inputMode="numeric" className="h-12" /></Field>
      <div className="divide-y rounded-xl border bg-surface">
        {items.map((i) => (
          <div key={i.key} className="space-y-2 px-4 py-3">
            <input type="hidden" name={`item:${i.key}`} value={results[i.key]} />
            <p className="text-[15px] font-medium">{i.label}</p>
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={i.label}>
              {(["PASS", "FAIL", "NA"] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={results[i.key] === r} onClick={() => setResults((s) => ({ ...s, [i.key]: r }))}
                  className={cn("h-11 rounded-lg border text-[14px] font-medium", results[i.key] === r && (r === "PASS" ? "border-success bg-success-soft text-success" : r === "FAIL" ? "border-danger bg-danger-soft text-danger" : "border-input bg-subtle"))}>
                  {r === "NA" ? "N/A" : r === "PASS" ? "OK" : "Defect"}
                </button>
              ))}
            </div>
            {results[i.key] === "FAIL" && <Textarea name={`note:${i.key}`} rows={2} placeholder="Describe the defect" aria-label={`${i.label} defect description`} />}
          </div>
        ))}
      </div>
      <Field label="Photos (optional)" name="photos"><Input type="file" accept="image/*" capture="environment" multiple /></Field>
      <Field label="Comments" name="comments"><Textarea rows={2} /></Field>
      <Field label="Type your name to acknowledge" name="acknowledgedBy" required hint="Confirms you performed this inspection."><Input defaultValue={driverName} className="h-12" /></Field>
      <SubmitButton size="xl" className="w-full" pendingText="Saving…">Submit inspection</SubmitButton>
    </ActionForm>
  );
}
