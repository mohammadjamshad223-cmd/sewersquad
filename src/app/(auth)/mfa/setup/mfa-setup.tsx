"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ActionForm, Field, SubmitButton } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { beginMfaSetupAction, completeMfaSetupAction } from "../../actions";

export function MfaSetup() {
  const [setup, setSetup] = useState<{ base32: string; qrSvg: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);

  useEffect(() => {
    beginMfaSetupAction()
      .then(setSetup)
      .catch(() => setError("Could not start setup. Reload the page to try again."));
  }, []);

  if (codes) {
    return (
      <div className="mt-6 space-y-4">
        <Alert tone="success" title="Two-factor authentication enabled">
          Save these one-time recovery codes somewhere safe. Each can be used once if you lose your device.
        </Alert>
        <ul className="grid grid-cols-2 gap-2 rounded-lg border bg-subtle p-4 font-mono text-sm">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button asChild className="w-full" size="lg">
          <Link href="/">Continue</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-5">
      {error && <Alert tone="danger">{error}</Alert>}
      {setup ? (
        <>
          <div className="flex justify-center rounded-lg border bg-white p-4" aria-label="QR code for authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <div>
            <p className="text-[12px] font-medium uppercase tracking-wide text-muted-foreground">Or enter this key manually</p>
            <p className="mt-1 break-all font-mono text-sm">{setup.base32}</p>
          </div>
          <ActionForm action={completeMfaSetupAction} className="space-y-4" refresh={false} onSuccess={(s) => s.ok && setCodes((s.data as { codes: string[] }).codes)}>
            <Field label="6-digit code" name="code" required>
              <Input inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" />
            </Field>
            <SubmitButton className="w-full" size="lg" pendingText="Verifying…">
              Verify and enable
            </SubmitButton>
          </ActionForm>
        </>
      ) : (
        !error && <div className="h-48 animate-pulse rounded-lg bg-subtle" aria-label="Loading" />
      )}
    </div>
  );
}
