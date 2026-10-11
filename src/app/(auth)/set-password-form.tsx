"use client";

import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

export function SetPasswordForm({ token, action, cta }: { token: string; action: (s: ActionState, fd: FormData) => Promise<ActionState>; cta: string }) {
  return (
    <ActionForm action={action} className="mt-8 space-y-4" refresh={false}>
      <input type="hidden" name="token" value={token} />
      <Field label="New password" name="password" required hint="At least 10 characters, including a letter and a number.">
        <Input type="password" autoComplete="new-password" autoFocus />
      </Field>
      <Field label="Confirm password" name="confirm" required>
        <Input type="password" autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Saving…">
        {cta}
      </SubmitButton>
    </ActionForm>
  );
}
