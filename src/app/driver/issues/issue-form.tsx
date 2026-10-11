"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Select, Textarea } from "@/components/ui/input";
import { reportIssueAction } from "../actions";

export function IssueForm({ jobs, vehicles, defaultVehicleId, defaultJobId }: { jobs: { id: string; label: string }[]; vehicles: { id: string; unitNumber: string }[]; defaultVehicleId: string | null; defaultJobId?: string }) {
  return (
    <ActionForm action={reportIssueAction} className="space-y-4" resetOnSuccess>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category" name="category" required><Select className="h-12"><option value="SERVICE">Service issue</option><option value="ACCESS">Site access</option><option value="EQUIPMENT">Customer equipment</option><option value="VEHICLE">Truck / vehicle</option><option value="SAFETY">Safety</option><option value="CUSTOMER">Customer concern</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Severity" name="severity" required><Select className="h-12" defaultValue="MEDIUM"><option value="LOW">Low</option><option value="MEDIUM">Medium</option><option value="HIGH">High</option><option value="CRITICAL">Critical — stop work</option></Select></Field>
      </div>
      <Field label="Related job" name="jobId"><Select className="h-12" defaultValue={defaultJobId ?? ""}><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</Select></Field>
      <Field label="Truck" name="vehicleId"><Select className="h-12" defaultValue={defaultVehicleId ?? ""}><option value="">None</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
      <Field label="What happened?" name="description" required><Textarea rows={5} /></Field>
      <SubmitButton size="xl" className="w-full" pendingText="Sending…">Send to office</SubmitButton>
    </ActionForm>
  );
}
