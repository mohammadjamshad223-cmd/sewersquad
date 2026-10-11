"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { loginAction } from "../actions";

export function LoginForm({ next }: { next?: string }) {
  return (
    <ActionForm action={loginAction} className="mt-8 space-y-4" refresh={false}>
      {next && <input type="hidden" name="next" value={next} />}
      <Field label="Email" name="email" required>
        <Input type="email" autoComplete="email" autoFocus inputMode="email" />
      </Field>
      <Field label="Password" name="password" required>
        <Input type="password" autoComplete="current-password" />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingText="Signing in…">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
