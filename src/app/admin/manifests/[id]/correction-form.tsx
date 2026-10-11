"use client";

import * as React from "react";
import { Plus, X } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { correctManifestAction, uploadOfficialManifestAction } from "@/app/admin/_actions/billing";

export function CorrectionForm({ manifestId, extra }: { manifestId: string; extra: Record<string, string> }) {
  const [rows, setRows] = React.useState(Object.entries(extra).length ? Object.entries(extra) : [["", ""]]);
  return (
    <ActionForm action={correctManifestAction} className="space-y-3">
      <input type="hidden" name="manifestId" value={manifestId} />
      <p className="text-[13px] text-muted-foreground">Field data is re-read from the current job, fleet, disposal and company records. Fix source records (e.g. send the job back to the driver, record the disposal event, update hauler settings) and use additional fields below for jurisdiction-specific values.</p>
      {rows.map(([k, v], i) => (
        <div key={i} className="flex gap-2">
          <Input name="extraKey" defaultValue={k} placeholder="Field (e.g. City of Houston permit #)" aria-label="Additional field name" />
          <Input name="extraValue" defaultValue={v} placeholder="Value" aria-label="Additional field value" />
          <Button type="button" variant="ghost" size="icon" aria-label="Remove field" onClick={() => setRows((r) => r.filter((_, j) => j !== i))}><X /></Button>
        </div>
      ))}
      <Button type="button" variant="ghost" size="sm" onClick={() => setRows((r) => [...r, ["", ""]])}><Plus /> Add field</Button>
      <Field label="Reason for correction" name="reason" required><Textarea rows={2} /></Field>
      <SubmitButton variant="secondary">Create revision</SubmitButton>
    </ActionForm>
  );
}

export function OfficialUploadForm({ manifestId }: { manifestId: string }) {
  return (
    <ActionForm action={uploadOfficialManifestAction} className="space-y-3" encType="multipart/form-data" resetOnSuccess>
      <input type="hidden" name="manifestId" value={manifestId} />
      <Field label="Official third-party manifest (PDF or photo)" name="file" required><Input type="file" accept="application/pdf,image/*" /></Field>
      <label className="flex items-center gap-2 text-sm"><Checkbox name="visible" defaultChecked /> Share with customer</label>
      <SubmitButton variant="secondary">Upload original</SubmitButton>
    </ActionForm>
  );
}
