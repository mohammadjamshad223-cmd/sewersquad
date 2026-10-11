"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { setupAction } from "../actions";

export function SetupForm() {
  return (
    <ActionForm action={setupAction} className="mt-8 space-y-4" refresh={false}>
      <Field label="Setup code" name="token" required>
        <Input type="password" autoComplete="off" autoFocus />
      </Field>
      <Field label="Your name" name="name" required>
        <Input autoComplete="name" />
      </Field>
      <Field label="Email" name="email" required>
        <Input type="email" autoComplete="email" />
      </Field>
      <Field label="Password" name="password" required hint="At least 10 characters, including a letter and a number.">
        <Input type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm password" name="confirm" required>
        <Input type="password" autoComplete="new-password" />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Creating account…">
        Create owner account
      </SubmitButton>
    </ActionForm>
  );
}
