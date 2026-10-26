"use client";

import * as React from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { sendTestTextAction } from "@/app/admin/_actions/settings";

type Step = { label: string; ok: boolean | null; detail?: string };

export function TestTextForm() {
  const [steps, setSteps] = React.useState<Step[] | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm
        action={sendTestTextAction as (s: ActionState, fd: FormData) => Promise<ActionState>}
        successMessage={false}
        refresh={false}
        onSuccess={(s) => s.ok && setSteps((s.data as { steps: Step[] }).steps)}
        className="flex flex-wrap items-end gap-3"
      >
        <Field label="Send a test text to" name="to"><Input type="tel" placeholder="346-244-5579" className="w-56" /></Field>
        <SubmitButton variant="secondary">Send test text</SubmitButton>
        <p className="pb-2 text-[13px] text-muted-foreground">Sends a real text and waits a few seconds for the carrier to confirm delivery.</p>
      </ActionForm>
      {steps && (
        <ul className="space-y-2">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-2 text-[13px]">
              {s.ok === null ? <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />}
              <span><span className="font-medium">{s.label}</span>{s.detail ? <span className="block text-muted-foreground">{s.detail}</span> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
