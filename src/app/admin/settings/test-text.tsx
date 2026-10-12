"use client";

import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { sendTestTextAction } from "@/app/admin/_actions/settings";

export function TestTextForm() {
  return (
    <ActionForm action={sendTestTextAction as (s: ActionState, fd: FormData) => Promise<ActionState>} className="flex flex-wrap items-end gap-3">
      <Field label="Send a test text to" name="to"><Input type="tel" placeholder="346-244-5579" className="w-56" /></Field>
      <SubmitButton variant="secondary">Send test text</SubmitButton>
    </ActionForm>
  );
}
