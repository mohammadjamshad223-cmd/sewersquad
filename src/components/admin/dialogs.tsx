"use client";

import * as React from "react";
import { Pencil, Plus } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { FormDialog } from "@/components/ui/dialog";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Textarea } from "@/components/ui/input";
import { AssetForm, BillingProfileForm, ContactForm, InviteCustomerUserForm, LocationForm, OrganizationForm, PlanForm, type PlanInit } from "./customer-forms";

type Trigger = { label: string; variant?: ButtonProps["variant"]; size?: ButtonProps["size"]; icon?: "plus" | "edit" };
function trig({ label, variant = "secondary", size = "sm", icon }: Trigger) {
  return (
    <Button variant={variant} size={size}>
      {icon === "plus" ? <Plus /> : icon === "edit" ? <Pencil /> : null}
      {label}
    </Button>
  );
}

export function OrgDialog({ trigger, ...p }: { trigger: Trigger } & React.ComponentProps<typeof OrganizationForm>) {
  return <FormDialog trigger={trig(trigger)} title="Edit customer" size="lg">{(close) => <OrganizationForm {...p} onDone={close} />}</FormDialog>;
}
export function LocationDialog({ trigger, title, ...p }: { trigger: Trigger; title: string } & React.ComponentProps<typeof LocationForm>) {
  return <FormDialog trigger={trig(trigger)} title={title} size="xl">{(close) => <LocationForm {...p} onDone={close} />}</FormDialog>;
}
export function AssetDialog({ trigger, title, ...p }: { trigger: Trigger; title: string } & React.ComponentProps<typeof AssetForm>) {
  return <FormDialog trigger={trig(trigger)} title={title} size="lg">{(close) => <AssetForm {...p} onDone={close} />}</FormDialog>;
}
export function ContactDialog({ trigger, title, ...p }: { trigger: Trigger; title: string } & React.ComponentProps<typeof ContactForm>) {
  return <FormDialog trigger={trig(trigger)} title={title} size="lg">{(close) => <ContactForm {...p} onDone={close} />}</FormDialog>;
}
export function BillingDialog({ trigger, title, ...p }: { trigger: Trigger; title: string } & React.ComponentProps<typeof BillingProfileForm>) {
  return <FormDialog trigger={trig(trigger)} title={title} size="lg">{(close) => <BillingProfileForm {...p} onDone={close} />}</FormDialog>;
}
export function PlanDialog({ trigger, title, ...p }: { trigger: Trigger; title: string; plan?: PlanInit } & React.ComponentProps<typeof PlanForm>) {
  return <FormDialog trigger={trig(trigger)} title={title} size="xl">{(close) => <PlanForm {...p} onDone={close} />}</FormDialog>;
}
export function InviteUserDialog({ trigger, ...p }: { trigger: Trigger } & React.ComponentProps<typeof InviteCustomerUserForm>) {
  return <FormDialog trigger={trig(trigger)} title="Invite customer user" description="They'll receive an email link to set a password (valid 7 days)." size="lg">{(close) => <InviteCustomerUserForm {...p} onDone={close} />}</FormDialog>;
}

/**
 * Generic dialog wrapping a server action: hidden fields + optional reason/notes + extra inputs.
 * Used for confirm-with-reason operations (deactivate, cancel, void, reject…).
 */
export function ReasonDialog({
  trigger,
  title,
  description,
  action,
  hidden,
  reasonName = "reason",
  reasonLabel = "Reason",
  reasonRequired = true,
  submitLabel,
  submitVariant = "primary",
  children,
}: {
  trigger: Trigger;
  title: string;
  description?: string;
  action: (s: ActionState, fd: FormData) => Promise<ActionState>;
  hidden: Record<string, string>;
  reasonName?: string;
  reasonLabel?: string;
  reasonRequired?: boolean;
  submitLabel: string;
  submitVariant?: ButtonProps["variant"];
  children?: React.ReactNode;
}) {
  return (
    <FormDialog trigger={trig(trigger)} title={title} description={description}>
      {(close) => (
        <ActionForm action={action} className="space-y-4" onSuccess={close}>
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          {children}
          {reasonName && <Field label={reasonLabel} name={reasonName} required={reasonRequired}><Textarea rows={3} /></Field>}
          <SubmitButton variant={submitVariant}>{submitLabel}</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function FieldInput(props: React.ComponentProps<typeof Input> & { label: string; name: string; required?: boolean; hint?: string }) {
  const { label, name, required, hint, ...rest } = props;
  return <Field label={label} name={name} required={required} hint={hint}><Input {...rest} /></Field>;
}
