"use client";

import { useState } from "react";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { createTicketAction } from "../../actions";

const CATEGORIES = [
  ["GENERAL", "General inquiry"],
  ["BILLING", "Billing question"],
  ["SERVICE_ISSUE", "Report a service issue"],
  ["CALLBACK", "Request a callback"],
  ["RESCHEDULE", "Request a schedule change"],
  ["ADDITIONAL_SERVICE", "Request additional service"],
] as const;

export function TicketForm({ locations, defaults }: { locations: { id: string; name: string }[]; defaults: { category?: string; jobId?: string; invoiceId?: string; locationId?: string | null; subject?: string; phone?: string } }) {
  const [category, setCategory] = useState(defaults.category && CATEGORIES.some(([c]) => c === defaults.category) ? defaults.category : "GENERAL");
  return (
    <ActionForm action={createTicketAction} className="grid gap-4 sm:grid-cols-2" refresh={false} encType="multipart/form-data">
      {defaults.jobId && <input type="hidden" name="jobId" value={defaults.jobId} />}
      {defaults.invoiceId && <input type="hidden" name="invoiceId" value={defaults.invoiceId} />}
      <Field label="Topic" name="category" required>
        <Select value={category} onChange={(e) => setCategory(e.target.value)}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Location" name="locationId">
        <Select defaultValue={defaults.locationId ?? ""}><option value="">General / all locations</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
      </Field>
      <Field label="Subject" name="subject" required className="sm:col-span-2">
        <Input defaultValue={defaults.subject} maxLength={200} />
      </Field>
      {category === "RESCHEDULE" && (
        <Field label="Preferred new date" name="requestedDate" hint="Dispatch will confirm. Your current appointment stays in place until then.">
          <Input type="date" />
        </Field>
      )}
      {category === "CALLBACK" && (
        <Field label="Callback phone" name="callbackPhone" required>
          <Input type="tel" defaultValue={defaults.phone} />
        </Field>
      )}
      <Field label="Message" name="body" required className="sm:col-span-2">
        <Textarea rows={6} />
      </Field>
      <Field label="Attachments (optional)" name="attachments" className="sm:col-span-2" hint="Up to 5 files: PDF, images, DOCX/XLSX.">
        <Input type="file" multiple />
      </Field>
      <div className="sm:col-span-2"><SubmitButton pendingText="Sending…">Send inquiry</SubmitButton></div>
    </ActionForm>
  );
}
