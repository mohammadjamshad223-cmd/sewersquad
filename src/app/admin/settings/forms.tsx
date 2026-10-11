"use client";

import { Plus, Pencil } from "lucide-react";
import { ActionForm, ActionButton, Field, SubmitButton } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { sendAccessLinkAction } from "@/app/admin/_actions/customers";
import { changeStaffRoleAction, inviteStaffAction, saveRolePermissionsAction, saveSettingsAction, saveTemplateAction, setStaffActiveAction } from "@/app/admin/_actions/settings";
import { savePricingRuleAction } from "@/app/admin/_actions/billing";
import { SERVICE_TYPE_LABEL } from "@/lib/status";

export type SettingField = { name: string; label: string; type: "text" | "number" | "bool" | "textarea" | "list" | "json" | "time"; value: unknown; hint?: string };

export function SettingsForm({ section, fields, disabled }: { section: string; fields: SettingField[]; disabled?: boolean }) {
  return (
    <ActionForm action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="section" value={section} />
      {fields.map((f) =>
        f.type === "bool" ? (
          <label key={f.name} className="flex items-start gap-2 text-sm sm:col-span-2"><Checkbox name={f.name} defaultChecked={Boolean(f.value)} disabled={disabled} className="mt-0.5" /><span>{f.label}{f.hint && <span className="block text-[12px] text-muted-foreground">{f.hint}</span>}</span></label>
        ) : (
          <Field key={f.name} label={f.label} name={f.name} hint={f.hint} className={f.type === "textarea" || f.type === "json" ? "sm:col-span-2" : undefined}>
            {f.type === "textarea" || f.type === "json" ? <Textarea rows={f.type === "json" ? 6 : 3} defaultValue={f.type === "json" ? JSON.stringify(f.value, null, 2) : String(f.value ?? "")} disabled={disabled} className={f.type === "json" ? "font-mono text-[12px]" : undefined} /> : <Input type={f.type === "number" ? "number" : f.type === "time" ? "time" : "text"} defaultValue={f.type === "list" ? (f.value as number[]).join(", ") : String(f.value ?? "")} disabled={disabled} />}
          </Field>
        ),
      )}
      {!disabled && <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>}
    </ActionForm>
  );
}

type Rule = { id: string; name: string; kind: string; serviceType: string | null; amount: string; percent: string; active: boolean; organizationId: string | null };

export function PricingRuleDialog({ rule, orgs }: { rule?: Rule; orgs: { id: string; name: string }[] }) {
  return (
    <FormDialog trigger={<Button size="sm" variant={rule ? "ghost" : "primary"}>{rule ? <Pencil /> : <Plus />}{rule ? "Edit" : "Add rule"}</Button>} title={rule ? "Edit pricing rule" : "Add pricing rule"} size="lg">
      {(close) => (
        <ActionForm action={savePricingRuleAction} className="grid gap-4 sm:grid-cols-2" onSuccess={close}>
          {rule && <input type="hidden" name="ruleId" value={rule.id} />}
          <Field label="Name" name="name" required className="sm:col-span-2"><Input defaultValue={rule?.name} /></Field>
          <Field label="Kind" name="kind" required><Select defaultValue={rule?.kind ?? "PER_GALLON"}>{[["PER_GALLON", "Price per gallon"], ["FLAT_RATE", "Flat-rate service"], ["MINIMUM_CHARGE", "Minimum service charge"], ["EMERGENCY_SURCHARGE", "Emergency surcharge"], ["AFTER_HOURS", "After-hours"], ["ADDITIONAL_EQUIPMENT", "Additional equipment"], ["DISPOSAL_FEE", "Disposal fee (per gallon)"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Service type" name="serviceType"><Select defaultValue={rule?.serviceType ?? ""}><option value="">All services</option>{Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
          <Field label="Amount ($)" name="amount" hint="Per gallon for per-gallon rules (e.g. 0.32); flat amount otherwise."><Input inputMode="decimal" defaultValue={rule?.amount ?? ""} /></Field>
          <Field label="Percent (%)" name="percent" hint="Surcharges only: e.g. 50 = +50% of the base charge."><Input inputMode="decimal" defaultValue={rule?.percent ?? ""} /></Field>
          <Field label="Applies to" name="organizationId" className="sm:col-span-2" hint="Customer-specific rules override company defaults."><Select defaultValue={rule?.organizationId ?? ""}><option value="">Company default</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></Field>
          <label className="flex items-center gap-2 text-sm"><Checkbox name="active" defaultChecked={rule?.active ?? true} /> Active</label>
          <div className="sm:col-span-2"><SubmitButton>Save rule</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function TemplateForm({ t }: { t: { id: string; name: string; jurisdiction: string; fields: unknown; notes: string | null; active: boolean } }) {
  return (
    <ActionForm action={saveTemplateAction} className="space-y-3">
      <input type="hidden" name="templateId" value={t.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" name="name" required><Input defaultValue={t.name} /></Field>
        <Field label="Jurisdiction" name="jurisdiction" required hint="e.g. TX, TX-HARRIS, TX-HOUSTON"><Input defaultValue={t.jurisdiction} /></Field>
      </div>
      <Field label="Fields (JSON)" name="fieldsJson" required hint='Each: { key: "section.field" or "extra.name", label, section, required, source }. "required" fields block finalization when empty.'><Textarea rows={14} className="font-mono text-[12px]" defaultValue={JSON.stringify(t.fields, null, 2)} /></Field>
      <Field label="Notes" name="notes"><Textarea rows={2} defaultValue={t.notes ?? ""} /></Field>
      <label className="flex items-center gap-2 text-sm"><Checkbox name="active" defaultChecked={t.active} /> Active</label>
      <SubmitButton>Save template</SubmitButton>
    </ActionForm>
  );
}

export function RolePermissionsForm({ roleKey, groups, granted, disabled }: { roleKey: string; groups: { group: string; perms: { key: string; description: string }[] }[]; granted: string[]; disabled: boolean }) {
  return (
    <ActionForm action={saveRolePermissionsAction} className="space-y-4">
      <input type="hidden" name="roleKey" value={roleKey} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <fieldset key={g.group} className="space-y-1.5">
            <legend className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{g.group}</legend>
            {g.perms.map((p) => <label key={p.key} className="flex items-start gap-2 text-[13px]"><Checkbox name="permissions" value={p.key} defaultChecked={granted.includes(p.key)} disabled={disabled || p.key === "staff.manage"} className="mt-0.5" /><span>{p.description}<span className="block font-mono text-[11px] text-muted-foreground">{p.key}</span></span></label>)}
          </fieldset>
        ))}
      </div>
      {!disabled && <SubmitButton variant="secondary">Save permissions</SubmitButton>}
    </ActionForm>
  );
}

export function InviteStaffDialog({ canSuper }: { canSuper: boolean }) {
  return (
    <FormDialog trigger={<Button size="sm"><Plus /> Invite staff</Button>} title="Invite staff member" description="Privileged roles must enroll in two-factor authentication on first sign-in.">
      {(close) => (
        <ActionForm action={inviteStaffAction} className="space-y-4" onSuccess={close}>
          <Field label="Name" name="name" required><Input /></Field>
          <Field label="Email" name="email" required><Input type="email" /></Field>
          <Field label="Phone" name="phone"><Input type="tel" /></Field>
          <Field label="Role" name="roleKey" required><Select defaultValue="dispatcher">{canSuper && <option value="super_admin">Super Admin</option>}<option value="admin">Admin</option><option value="dispatcher">Dispatcher</option><option value="accounting">Accounting</option></Select></Field>
          <SubmitButton>Send invitation</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function StaffRow({ user, roles, canEdit, self }: { user: { id: string; roleKey: string | null; status: string }; roles: { key: string; name: string }[]; canEdit: boolean; self: boolean }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <select aria-label="Role" className="h-8 rounded-md border border-input bg-surface px-2 text-[13px]" defaultValue={user.roleKey ?? ""} disabled={!canEdit || self} onChange={async (e) => {
        const { toast } = await import("sonner");
        const res = await changeStaffRoleAction(user.id, e.target.value);
        if (res.ok) toast.success("Role updated. The user must sign in again."); else toast.error(res.error);
      }}>
        {roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
      </select>
      {canEdit && !self && user.status !== "DEACTIVATED" && <ActionButton size="sm" variant="ghost" action={() => sendAccessLinkAction(user.id)} refresh={false}>{user.status === "INVITED" ? "Resend invite" : "Send reset link"}</ActionButton>}
      {canEdit && !self && <ActionButton size="sm" variant="ghost" action={() => setStaffActiveAction(user.id, user.status === "DEACTIVATED")} confirm={user.status === "DEACTIVATED" ? undefined : "Deactivate this staff account? They'll be signed out immediately."} successMessage="Updated.">{user.status === "DEACTIVATED" ? "Reactivate" : "Deactivate"}</ActionButton>}
    </div>
  );
}
