"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { forgotPasswordAction } from "../actions";

export default function ForgotPasswordPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-muted-foreground">We&apos;ll email you a secure link that expires in one hour.</p>
      <ActionForm action={forgotPasswordAction} className="mt-8 space-y-4" resetOnSuccess refresh={false}>
        <Field label="Email" name="email" required>
          <Input type="email" autoComplete="email" autoFocus />
        </Field>
        <SubmitButton className="w-full" size="lg" pendingText="Sending…">
          Send reset link
        </SubmitButton>
      </ActionForm>
      <p className="mt-6 text-[13px]">
        <Link href="/login" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
