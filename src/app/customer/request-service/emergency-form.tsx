"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { SERVICE_TYPE_LABEL, EMERGENCY_CATEGORY_LABEL } from "@/lib/status";
import { submitEmergencyAction } from "../actions";
import { useState } from "react";

export function EmergencyForm({ locations, defaultLocationId, contact }: { locations: { id: string; name: string }[]; defaultLocationId: string | null; contact: { name: string; phone: string; email: string } }) {
  const [timing, setTiming] = useState("ASAP");
  return (
    <ActionForm action={submitEmergencyAction} className="grid gap-4 sm:grid-cols-2" refresh={false} encType="multipart/form-data">
      <Field label="Service location" name="locationId" required className="sm:col-span-2">
        <Select defaultValue={defaultLocationId ?? locations[0]?.id}>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      <Field label="What's happening?" name="category" required>
        <Select defaultValue="TRAP_OVERFLOWING">{Object.entries(EMERGENCY_CATEGORY_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Severity" name="severity" required>
        <Select defaultValue="URGENT">
          <option value="URGENT">Urgent — active overflow / health risk</option>
          <option value="HIGH">High — needs service today</option>
          <option value="STANDARD">Standard — next available</option>
        </Select>
      </Field>
      <Field label="Service needed" name="serviceType" required>
        <Select defaultValue="GREASE_TRAP_PUMPING">{Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Requested timing" name="requestedTiming" required>
        <Select value={timing} onChange={(e) => setTiming(e.target.value)}>
          <option value="ASAP">As soon as possible</option>
          <option value="TODAY">Later today</option>
          <option value="NEXT_BUSINESS_DAY">Next business day</option>
          <option value="SPECIFIC_TIME">A specific time</option>
        </Select>
      </Field>
      {timing === "SPECIFIC_TIME" && (
        <Field label="Preferred date & time" name="requestedFor" className="sm:col-span-2">
          <Input type="datetime-local" />
        </Field>
      )}
      <Field label="Description" name="description" required className="sm:col-span-2" hint="Where is the problem, what do you see, and is anything blocking access?">
        <Textarea rows={4} />
      </Field>
      <Field label="Contact name" name="contactName" required>
        <Input defaultValue={contact.name} autoComplete="name" />
      </Field>
      <Field label="Contact phone" name="contactPhone" required>
        <Input defaultValue={contact.phone} type="tel" autoComplete="tel" />
      </Field>
      <Field label="Contact email" name="contactEmail">
        <Input defaultValue={contact.email} type="email" />
      </Field>
      <Field label="Preferred contact method" name="preferredContact" required>
        <Select defaultValue="PHONE"><option value="PHONE">Phone call</option><option value="SMS">Text message</option><option value="EMAIL">Email</option></Select>
      </Field>
      <Field label="Photos or videos (optional)" name="photos" className="sm:col-span-2" hint="Up to 6 photos (JPEG, PNG, HEIC). Videos can be sent by text once dispatch contacts you.">
        <Input type="file" multiple accept="image/*" capture="environment" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton variant="danger" size="lg" pendingText="Submitting…">Submit emergency request</SubmitButton>
      </div>
    </ActionForm>
  );
}
