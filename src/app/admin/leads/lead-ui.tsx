"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Mail, MessageSquare, Phone, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { createLeadAction, logLeadContactAction, setLeadStatusAction } from "@/app/admin/_actions/leads";

const tel = (p: string) => p.replace(/[^\d+]/g, "");

/** Call / Text / Email open the phone's app and record the contact (first contact sets the response time). */
export function LeadContactButtons({ lead, compact = false }: { lead: { id: string; phone: string | null; email: string | null; name: string | null; subject: string | null; contacted: boolean }; compact?: boolean }) {
  const router = useRouter();
  const [, start] = React.useTransition();
  const log = (method: "call" | "text" | "email" | "other") =>
    start(async () => {
      const res = await logLeadContactAction(lead.id, method);
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    });
  const first = lead.name?.split(" ")[0];
  return (
    <div className="flex flex-wrap gap-2">
      {lead.phone && <a href={`tel:${tel(lead.phone)}`} onClick={() => log("call")} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3 text-[13px] font-semibold text-white"><Phone className="h-3.5 w-3.5" />Call</a>}
      {lead.phone && <a href={`sms:${tel(lead.phone)}?&body=${encodeURIComponent(`Hi${first ? ` ${first}` : ""}, this is Sewer Squad following up on your inquiry. `)}`} onClick={() => log("text")} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-surface px-3 text-[13px] font-medium"><MessageSquare className="h-3.5 w-3.5" />Text</a>}
      {lead.email && <a href={`mailto:${lead.email}?subject=${encodeURIComponent(`Re: ${lead.subject ?? "Your inquiry"}`)}`} onClick={() => log("email")} className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-surface px-3 text-[13px] font-medium"><Mail className="h-3.5 w-3.5" />Email</a>}
      {!lead.contacted && !compact && <Button size="sm" variant="secondary" className="h-9" onClick={() => log("other")}><CheckCircle2 /> Mark contacted</Button>}
    </div>
  );
}

export function LeadStatusSelect({ id, status }: { id: string; status: string }) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  return (
    <Select aria-label="Lead status" value={status} disabled={pending} className="h-9 w-40" onChange={(e) => start(async () => {
      const res = await setLeadStatusAction(id, e.target.value as "NEW");
      if (!res.ok) toast.error(res.error);
      else router.refresh();
    })}>
      <option value="NEW">New</option>
      <option value="CONTACTED">Contacted</option>
      <option value="QUOTED">Quoted</option>
      <option value="WON">Won — customer</option>
      <option value="LOST">Lost</option>
    </Select>
  );
}

export function AddLeadDialog() {
  return (
    <FormDialog trigger={<Button size="sm"><Plus /> Add lead</Button>} title="Add a lead" description="For calls, referrals and walk-ins. Emailed inquiries are added automatically.">
      {() => (
        <ActionForm action={createLeadAction as (s: ActionState, fd: FormData) => Promise<ActionState>} className="grid gap-3 sm:grid-cols-2" refresh={false}>
          <Field label="Name" name="name"><Input /></Field>
          <Field label="Business" name="company"><Input /></Field>
          <Field label="Phone" name="phone"><Input type="tel" /></Field>
          <Field label="Email" name="email"><Input type="email" /></Field>
          <Field label="How they reached us" name="source"><Select defaultValue="phone"><option value="phone">Phone call</option><option value="website">Website</option><option value="referral">Referral</option><option value="email">Email</option><option value="other">Other</option></Select></Field>
          <label className="flex items-end gap-2 pb-2 text-[14px]"><Checkbox name="contactedNow" defaultChecked /> Already spoke with them</label>
          <Field label="What they need" name="message" className="sm:col-span-2"><Textarea rows={3} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Add lead</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}
