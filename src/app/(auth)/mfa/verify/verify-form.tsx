"use client";

import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { verifyMfaAction } from "../../actions";
import { logoutAction } from "../../actions";
import { Button } from "@/components/ui/button";

export function MfaVerifyForm() {
  return (
    <>
      <ActionForm action={verifyMfaAction} className="mt-8 space-y-4" refresh={false}>
        <Field label="Code" name="code" required>
          <Input autoComplete="one-time-code" autoFocus maxLength={11} />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Verifying…">
          Verify
        </SubmitButton>
      </ActionForm>
      <form action={logoutAction} className="mt-4">
        <Button variant="link" type="submit">
          Sign in as a different user
        </Button>
      </form>
    </>
  );
}
