"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Checkbox, Select, Textarea } from "@/components/ui/input";
import { staffReplyAction, updateTicketAction } from "@/app/admin/_actions/ops";

export function StaffReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={staffReplyAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="ticketId" value={ticketId} />
      <label htmlFor="body" className="sr-only">Message</label>
      <Textarea id="body" name="body" rows={4} placeholder="Reply to the customer, or add an internal note…" />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm"><Checkbox name="internal" /> Internal note (never shown to the customer)</label>
        <Select name="status" aria-label="Set status" className="w-auto" defaultValue=""><option value="">Keep status</option><option value="WAITING_ON_CUSTOMER">Waiting on customer</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option></Select>
        <SubmitButton>Send</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function TicketMetaForm({ ticket, staff, jobs, invoices }: { ticket: { id: string; status: string; assignedToId: string | null; jobId: string | null; invoiceId: string | null }; staff: { id: string; name: string }[]; jobs: { id: string; label: string }[]; invoices: { id: string; label: string }[] }) {
  return (
    <ActionForm action={updateTicketAction} className="space-y-3">
      <input type="hidden" name="ticketId" value={ticket.id} />
      <Field label="Status" name="status"><Select defaultValue={ticket.status}>{["OPEN", "IN_PROGRESS", "WAITING_ON_CUSTOMER", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
      <Field label="Owner" name="assignedToId"><Select defaultValue={ticket.assignedToId ?? ""}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <Field label="Linked job" name="jobId"><Select defaultValue={ticket.jobId ?? ""}><option value="">None</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.label}</option>)}</Select></Field>
      <Field label="Linked invoice" name="invoiceId"><Select defaultValue={ticket.invoiceId ?? ""}><option value="">None</option>{invoices.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</Select></Field>
      <SubmitButton variant="secondary" size="sm">Update</SubmitButton>
    </ActionForm>
  );
}
