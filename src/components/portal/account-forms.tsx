"use client";

import Link from "next/link";
import { ActionForm, Field, SubmitButton, ActionButton } from "@/components/ui/form";
import { Input, Checkbox } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { changePasswordAction, disableMfaAction, requestEmailChangeAction, savePreferencesAction, signOutOtherSessionsAction, updateProfileAction } from "@/app/account/actions";

export function ProfileForm({ name, phone }: { name: string; phone: string | null }) {
  return (
    <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Full name" name="name" required>
        <Input defaultValue={name} autoComplete="name" />
      </Field>
      <Field label="Mobile phone" name="phone" hint="Used for optional SMS notifications.">
        <Input defaultValue={phone ?? ""} type="tel" autoComplete="tel" />
      </Field>
      <div className="sm:col-span-2">
        <SubmitButton>Save profile</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function EmailForm({ email }: { email: string }) {
  return (
    <ActionForm action={requestEmailChangeAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" resetOnSuccess>
      <Field label={`New email (current: ${email})`} name="email" className="flex-1">
        <Input type="email" autoComplete="email" />
      </Field>
      <SubmitButton variant="secondary">Send verification</SubmitButton>
    </ActionForm>
  );
}

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="grid gap-4 sm:grid-cols-3" resetOnSuccess>
      <Field label="Current password" name="current" required>
        <Input type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" name="next" required hint="10+ characters with a letter and a number.">
        <Input type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" name="confirm" required>
        <Input type="password" autoComplete="new-password" />
      </Field>
      <div className="sm:col-span-3">
        <SubmitButton variant="secondary">Change password</SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MfaPanel({ enabled, required }: { enabled: boolean; required: boolean }) {
  if (!enabled) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Add a second step at sign-in with an authenticator app.</p>
        <Button asChild>
          <Link href="/mfa/setup">Set up two-factor authentication</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm">
        <span className="font-medium text-success">Enabled.</span> You&apos;ll be asked for a code from your authenticator app at sign-in.
      </p>
      {required ? (
        <p className="text-[13px] text-muted-foreground">Two-factor authentication is required for your role.</p>
      ) : (
        <ActionForm action={disableMfaAction} className="flex flex-col gap-3 sm:flex-row sm:items-end" resetOnSuccess>
          <Field label="Confirm password to disable" name="password" className="flex-1">
            <Input type="password" autoComplete="current-password" />
          </Field>
          <SubmitButton variant="danger-outline">Disable</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}

export function SessionsPanel({ count }: { count: number }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground">
        {count} active session{count === 1 ? "" : "s"} (including this one). Sessions expire automatically after inactivity.
      </p>
      <ActionButton variant="secondary" action={signOutOtherSessionsAction} successMessage="Other sessions signed out." disabled={count <= 1}>
        Sign out other sessions
      </ActionButton>
    </div>
  );
}

export function PreferencesForm({ rows, smsAvailable }: { rows: { type: string; label: string; email: boolean; sms: boolean }[]; smsAvailable: boolean }) {
  return (
    <ActionForm action={savePreferencesAction} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[12px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 font-medium">Notification</th>
              <th className="w-20 py-2 text-center font-medium">In-app</th>
              <th className="w-20 py-2 text-center font-medium">Email</th>
              <th className="w-20 py-2 text-center font-medium">SMS</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => (
              <tr key={r.type}>
                <td className="py-2.5">
                  {r.label}
                  <input type="hidden" name={`present:${r.type}`} value="1" />
                </td>
                <td className="text-center">
                  <Checkbox checked disabled aria-label={`${r.label} in-app (always on)`} readOnly />
                </td>
                <td className="text-center">
                  <Checkbox name={`email:${r.type}`} defaultChecked={r.email} aria-label={`${r.label} email`} />
                </td>
                <td className="text-center">
                  <Checkbox name={`sms:${r.type}`} defaultChecked={r.sms} disabled={!smsAvailable} aria-label={`${r.label} SMS`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!smsAvailable && <p className="text-[12px] text-muted-foreground">SMS delivery is not configured for this platform yet.</p>}
      <SubmitButton variant="secondary">Save preferences</SubmitButton>
    </ActionForm>
  );
}
