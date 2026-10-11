"use client";

import { ActionForm, SubmitButton } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { replyTicketAction } from "../../actions";

export function ReplyForm({ ticketId }: { ticketId: string }) {
  return (
    <ActionForm action={replyTicketAction} className="space-y-3" resetOnSuccess>
      <input type="hidden" name="ticketId" value={ticketId} />
      <label className="sr-only" htmlFor="reply">Reply</label>
      <Textarea id="reply" name="body" rows={4} placeholder="Write a reply…" />
      <SubmitButton>Send reply</SubmitButton>
    </ActionForm>
  );
}
