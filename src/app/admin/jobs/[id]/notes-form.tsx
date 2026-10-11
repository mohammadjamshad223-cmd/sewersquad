"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { updateJobDetailsAction } from "@/app/admin/_actions/ops";

export function JobNotesForm({ job }: { job: { id: string; instructions: string | null; internalNotes: string | null; estimatedGallons: number | null; priority: string; confirmedByOffice: boolean } }) {
  return (
    <ActionForm action={updateJobDetailsAction} className="space-y-3">
      <input type="hidden" name="jobId" value={job.id} />
      <Field label="Driver instructions" name="instructions"><Textarea rows={3} defaultValue={job.instructions ?? ""} /></Field>
      <Field label="Internal notes" name="internalNotes" hint="Office only."><Textarea rows={2} defaultValue={job.internalNotes ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Est. gallons" name="estimatedGallons"><Input inputMode="numeric" defaultValue={job.estimatedGallons ?? ""} /></Field>
        <Field label="Priority" name="priority"><Select defaultValue={job.priority}><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="EMERGENCY">Emergency</option></Select></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><Checkbox name="confirmedByOffice" defaultChecked={job.confirmedByOffice} /> Confirmed with customer</label>
      <SubmitButton variant="secondary" size="sm">Save</SubmitButton>
    </ActionForm>
  );
}
