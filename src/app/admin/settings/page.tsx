import { Button } from "@/components/ui/button";
import Link from "next/link";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { env, integrations, maskSecret } from "@/server/env";
import { getAllSettings } from "@/server/services/settings";
import { PERMISSIONS, SYSTEM_ROLES, type Permission } from "@/server/authz/permissions";
import { stripeIsLiveKey } from "@/server/services/payments";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { AuditTrail } from "@/components/admin/audit-trail";
import { formatInstant } from "@/lib/dates";
import { formatRateCents, formatCents } from "@/lib/money";
import { SERVICE_TYPE_LABEL, LINE_ITEM_KIND_LABEL } from "@/lib/status";
import { titleCase } from "@/lib/utils";
import { InviteStaffDialog, PricingRuleDialog, RolePermissionsForm, SettingsForm, StaffRow, TemplateForm, type SettingField } from "./forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string; role?: string }> }) {
  const actor = await requireStaffPage("settings.read");
  const sp = await searchParams;
  const tab = sp.tab ?? "company";
  const s = await getAllSettings();
  const canWrite = hasPermission(actor, "settings.write");
  const tabs = [
    { key: "company", label: "Company" },
    { key: "operations", label: "Scheduling & emergency" },
    { key: "billing", label: "Billing" },
    { key: "pricing", label: "Pricing rules" },
    { key: "templates", label: "Manifest templates" },
    { key: "access", label: "Documents & access" },
    ...(hasPermission(actor, "staff.manage") ? [{ key: "staff", label: "Staff" }, { key: "roles", label: "Roles & permissions" }] : []),
    { key: "integrations", label: "Integrations" },
    ...(hasPermission(actor, "audit.read") ? [{ key: "audit", label: "Audit log" }] : []),
  ];
  const f = (name: string, label: string, type: SettingField["type"], value: unknown, hint?: string): SettingField => ({ name, label, type, value, hint });
  return (
    <div>
      <PageHeader title="Settings" description={canWrite ? "Company configuration. Every change is recorded in the audit log." : "Read-only — you need settings.write to change these."} actions={canWrite && <Button asChild variant="secondary" size="sm"><Link href="/admin/settings/import">Import your records</Link></Button>} />
      <Tabs basePath="/admin/settings" active={tab} tabs={tabs} />
      {tab === "company" && (
        <div className="space-y-6">
          <Card><CardHeader title="Company" /><CardBody><SettingsForm section="company" disabled={!canWrite} fields={[f("name", "Company name", "text", s.company.name), f("phone", "Main phone", "text", s.company.phone), f("email", "Office email", "text", s.company.email), f("website", "Website", "text", s.company.website), f("addressLine1", "Address", "text", s.company.addressLine1), f("city", "City", "text", s.company.city), f("state", "State", "text", s.company.state), f("postalCode", "ZIP", "text", s.company.postalCode), f("timeZone", "Operating time zone", "text", s.company.timeZone, "IANA name. Timestamps are stored in UTC and displayed in this zone.")]} /></CardBody></Card>
          <Card><CardHeader title="Hauler / transporter details" description="Printed on manifests and every invoice, proposal and report. Leave blank rather than guessing — missing values are shown as blank, never invented." /><CardBody><SettingsForm section="hauler" disabled={!canWrite} fields={[f("legalName", "Hauler legal name", "text", s.hauler.legalName), f("transporterPermitNumber", "Transporter permit / license #", "text", s.hauler.transporterPermitNumber), f("registrationNumber", "Registration #", "text", s.hauler.registrationNumber), f("tceqNumber", "TCEQ #", "text", s.hauler.tceqNumber, "Printed on invoices, proposals and service reports."), f("cityOfHoustonNumber", "City of Houston #", "text", s.hauler.cityOfHoustonNumber, "Printed next to the TCEQ # once entered."), f("manifestStartNumber", "Next manifest / ticket #", "number", s.hauler.manifestStartNumber, "Continue your paper ticket numbers (e.g. 194460). 0 = portal numbering MF-2026-000001."), f("certificationStatement", "Hauler certification statement", "textarea", s.hauler.certificationStatement)]} /></CardBody></Card>
          <Alert tone="info" title="Logo & brand colors">The official Sewer Squad logo and brand colors (navy #002957, green #65AA27) are applied across the portal, documents and emails. To change them, replace the files in <code>public/brand/</code> and the colors in <code>src/config/brand.ts</code> and <code>src/app/globals.css</code>, then redeploy.</Alert>
        </div>
      )}
      {tab === "operations" && (
        <div className="space-y-6">
          <Card><CardHeader title="Scheduling" /><CardBody><SettingsForm section="scheduling" disabled={!canWrite} fields={[f("horizonDays", "Scheduling horizon (days)", "number", s.scheduling.horizonDays, "Recurring visits are created this far ahead."), f("serviceReminderOffsetsDays", "Customer service reminders (days before)", "list", s.scheduling.serviceReminderOffsetsDays, "Comma-separated, e.g. 14, 7, 1"), f("defaultWindowStart", "Default window start", "time", s.scheduling.defaultWindowStart), f("defaultWindowEnd", "Default window end", "time", s.scheduling.defaultWindowEnd), f("serviceWindows", "Named service windows", "json", s.scheduling.serviceWindows)]} /></CardBody></Card>
          <Card><CardHeader title="Emergency service" /><CardBody><SettingsForm section="emergency" disabled={!canWrite} fields={[f("phone", "Emergency phone (shown to customers)", "text", s.emergency.phone), f("notice", "Notice on the emergency request form", "textarea", s.emergency.notice, "Should state that online submission does not guarantee immediate dispatch.")]} /></CardBody></Card>
        </div>
      )}
      {tab === "billing" && <Card><CardHeader title="Billing" /><CardBody><SettingsForm section="billing" disabled={!canWrite} fields={[f("defaultPaymentTermsDays", "Default payment terms (days)", "number", s.billing.defaultPaymentTermsDays), f("defaultTaxRateBps", "Default sales tax (basis points)", "number", s.billing.defaultTaxRateBps, "825 = 8.25%. Confirm taxability of services with your tax advisor."), f("allowPartialPayments", "Allow partial online payments by default", "bool", s.billing.allowPartialPayments), f("autoInvoiceOnApproval", "Generate invoices automatically when a job is approved", "bool", s.billing.autoInvoiceOnApproval), f("autoSendInvoices", "Send generated invoices automatically (only when fully priced)", "bool", s.billing.autoSendInvoices), f("lateFeeEnabled", "Late fees enabled", "bool", s.billing.lateFeeEnabled, "Only where legally and contractually permitted. Late fees are added manually as LATE_FEE line items."), f("lateFeeBps", "Late fee (basis points)", "number", s.billing.lateFeeBps), f("reminderOffsetsDays", "Invoice reminders (days relative to due date)", "list", s.billing.reminderOffsetsDays, "Negative = before due. Default: -3, 0, 7, 14, 30. Never sent for paid or voided invoices."), f("manifestFeeBps", "Manifest fee (basis points)", "number", s.billing.manifestFeeBps, "400 = 4% of the trap service. Each location chooses: none, Manifest fee, City of Houston manifest fee, or waived."), f("nextServiceDays", "Next service date (days after service)", "number", s.billing.nextServiceDays, "Printed on invoices when no recurring plan sets the date. 0 = don't print."), f("invoiceNote", "Invoice note closing line", "textarea", s.billing.invoiceNote), f("invoiceFooter", "Invoice footer", "textarea", s.billing.invoiceFooter, "Shown above the company line at the bottom of invoices.")]} /></CardBody></Card>}
      {tab === "pricing" && <Pricing canWrite={canWrite || hasPermission(actor, "invoices.write")} />}
      {tab === "templates" && <Templates canWrite={canWrite} />}
      {tab === "access" && (
        <div className="space-y-6">
          <Card><CardHeader title="Documents" /><CardBody><SettingsForm section="documents" disabled={!canWrite} fields={[f("maxUploadMb", "Maximum upload size (MB)", "number", s.documents.maxUploadMb), f("retentionYears", "Document retention policy (years)", "number", s.documents.retentionYears, "Documents are never auto-deleted; this records the policy for review and future archiving jobs.")]} /></CardBody></Card>
          <Card><CardHeader title="Customer portal access" /><CardBody><SettingsForm section="customerAccess" disabled={!canWrite} fields={[f("readOnlyCanPay", "Read-only customer users may pay invoices (if their membership allows)", "bool", s.customerAccess.readOnlyCanPay), f("showDriverNames", "Show technician names to customers", "bool", s.customerAccess.showDriverNames), f("allowRescheduleRequests", "Allow customers to request schedule changes", "bool", s.customerAccess.allowRescheduleRequests)]} /></CardBody></Card>
        </div>
      )}
      {tab === "staff" && <Staff actor={actor} />}
      {tab === "roles" && <Roles selected={sp.role ?? "admin"} canEdit={actor.roleKey === "super_admin"} />}
      {tab === "integrations" && (
        <Card>
          <CardHeader title="Integrations" description="Providers are configured with environment variables. Unconfigured features show an explicit 'not configured' state instead of pretending to work." />
          <Table>
            <THead><tr><TH>Integration</TH><TH>Status</TH><TH>Environment variables</TH></tr></THead>
            <TBody>
              {[
                ["Stripe payments", `${integrations.stripe() ? (stripeIsLiveKey() ? "Live mode" : "Test mode") : stripeIsLiveKey() ? "Live key present but disabled — set STRIPE_LIVE_APPROVED after test-mode sign-off" : "Not configured"}${env().STRIPE_SECRET_KEY ? ` · key ${maskSecret(env().STRIPE_SECRET_KEY)}` : ""}`, "STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_ENABLE_ACH, STRIPE_LIVE_APPROVED"],
                ["Email (Resend)", integrations.email() ? "Configured" : "Not configured — emails are logged as skipped", "RESEND_API_KEY, EMAIL_FROM"],
                ["SMS (Twilio)", integrations.sms() ? "Configured" : "Not configured (optional)", "TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER"],
                ["Document storage", integrations.s3() ? `S3 bucket ${env().S3_BUCKET}` : `Local disk (${env().NODE_ENV === "production" ? "not allowed in production" : "development only"})`, "STORAGE_DRIVER, S3_BUCKET, S3_REGION, S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY"],
                ["Maps", integrations.maps() ? "Configured" : "Not configured — schematic views only", "NEXT_PUBLIC_GOOGLE_MAPS_API_KEY"],
                ["Scheduled jobs", env().CRON_SECRET ? "Secret set" : "CRON_SECRET missing", "CRON_SECRET (see vercel.json)"],
                ["Admin MFA enforcement", env().REQUIRE_ADMIN_MFA === "true" ? "Required for super admin, admin, accounting" : "DISABLED (development)", "REQUIRE_ADMIN_MFA"],
              ].map(([name, status, vars]) => <TR key={name}><TD className="font-medium">{name}</TD><TD><Badge tone={/Not configured|missing|DISABLED|not allowed/.test(status!) ? "warning" : "success"}>{status}</Badge></TD><TD className="font-mono text-[12px] text-muted-foreground">{vars}</TD></TR>)}
            </TBody>
          </Table>
        </Card>
      )}
      {tab === "audit" && hasPermission(actor, "audit.read") && <AuditTrail where={{}} title="Audit log (latest 200)" take={200} />}
    </div>
  );
}

async function Pricing({ canWrite }: { canWrite: boolean }) {
  const [rules, orgs] = await Promise.all([prisma.pricingRule.findMany({ include: { organization: { select: { name: true } } }, orderBy: [{ organizationId: { sort: "asc", nulls: "first" } }, { kind: "asc" }] }), prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return (
    <Card>
      <CardHeader title="Pricing rules" description="Used when a job has no contracted plan price or confirmed quote. Prices are never hardcoded; jobs without a matching price produce a draft invoice flagged 'pricing required'." action={canWrite && <PricingRuleDialog orgs={orgs} />} />
      <Table>
        <THead><tr><TH>Rule</TH><TH>Kind</TH><TH>Service</TH><TH>Applies to</TH><TH className="text-right">Amount</TH><TH>Active</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
        <TBody>
          {rules.map((r) => (
            <TR key={r.id}>
              <TD className="font-medium">{r.name}</TD>
              <TD>{LINE_ITEM_KIND_LABEL[r.kind]}</TD>
              <TD>{r.serviceType ? SERVICE_TYPE_LABEL[r.serviceType] : "All"}</TD>
              <TD>{r.organization?.name ?? "Company default"}</TD>
              <TD className="text-right tabular-nums">{r.percentBps ? `${r.percentBps / 100}%` : r.kind === "PER_GALLON" || r.kind === "DISPOSAL_FEE" ? formatRateCents(r.amountCents.toString(), "gal") : formatCents(Number(r.amountCents))}</TD>
              <TD><Badge tone={r.active ? "success" : "neutral"}>{r.active ? "Active" : "Off"}</Badge></TD>
              <TD className="text-right">{canWrite && <PricingRuleDialog orgs={orgs} rule={{ id: r.id, name: r.name, kind: r.kind, serviceType: r.serviceType, amount: (Number(r.amountCents) / 100).toString(), percent: r.percentBps ? String(r.percentBps / 100) : "", active: r.active, organizationId: r.organizationId }} />}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

async function Templates({ canWrite }: { canWrite: boolean }) {
  const templates = await prisma.manifestTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return (
    <div className="space-y-6">
      <Alert tone="warning" title="Regulatory requirements vary">Manifest requirements differ by jurisdiction (e.g. City of Houston, Harris County, TCEQ), waste type and service type. Templates control which fields are required before a manifest can be finalized. Confirm requirements with each authority; this platform does not certify compliance.</Alert>
      {templates.map((t) => (
        <Card key={t.id}>
          <CardHeader title={<span className="flex items-center gap-2">{t.name}{t.isDefault && <Badge tone="brand">Default</Badge>}</span>} description={`${t.jurisdiction} · applies to ${t.serviceTypes.length ? t.serviceTypes.map((x) => SERVICE_TYPE_LABEL[x]).join(", ") : "all services"} · updated ${formatInstant(t.updatedAt, undefined, "date")}`} />
          <CardBody>{canWrite ? <TemplateForm t={{ id: t.id, name: t.name, jurisdiction: t.jurisdiction, fields: t.fields, notes: t.notes, active: t.active }} /> : <pre className="overflow-x-auto rounded bg-subtle p-3 text-[12px]">{JSON.stringify(t.fields, null, 2)}</pre>}</CardBody>
        </Card>
      ))}
    </div>
  );
}

async function Staff({ actor }: { actor: { userId: string; roleKey: string | null } }) {
  const [users, roles] = await Promise.all([prisma.user.findMany({ where: { kind: "STAFF" }, include: { role: true, driver: { select: { status: true } } }, orderBy: { name: "asc" } }), prisma.role.findMany({ where: { key: { not: "driver" } }, orderBy: { name: "asc" } })]);
  return (
    <Card>
      <CardHeader title="Staff users" description="Changing a role signs the user out so new permissions (and MFA requirements) apply immediately." action={<InviteStaffDialog canSuper={actor.roleKey === "super_admin"} />} />
      <Table>
        <THead><tr><TH>Name</TH><TH>MFA</TH><TH>Status</TH><TH>Last sign-in</TH><TH className="text-right">Access &amp; role</TH></tr></THead>
        <TBody>
          {users.map((u) => (
            <TR key={u.id}>
              <TD className="font-medium">{u.name}<span className="block text-[12px] font-normal text-muted-foreground">{u.email}</span></TD>
              <TD><Badge tone={u.mfaEnabledAt ? "success" : "warning"}>{u.mfaEnabledAt ? "Enabled" : "Off"}</Badge></TD>
              <TD><Badge tone={u.status === "ACTIVE" ? "success" : "neutral"}>{titleCase(u.status)}</Badge></TD>
              <TD className="text-[13px]">{u.lastLoginAt ? formatInstant(u.lastLoginAt) : "Never"}</TD>
              <TD><StaffRow user={{ id: u.id, roleKey: u.role?.key ?? null, status: u.status, fieldMode: !!u.driver && u.driver.status !== "INACTIVE" }} roles={roles.filter((r) => r.key !== "super_admin" || actor.roleKey === "super_admin" || u.role?.key === "super_admin").map((r) => ({ key: r.key, name: r.name }))} canEdit={u.role?.key !== "super_admin" || actor.roleKey === "super_admin"} self={u.id === actor.userId} /></TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

async function Roles({ selected, canEdit }: { selected: string; canEdit: boolean }) {
  const role = await prisma.role.findUnique({ where: { key: selected }, include: { permissions: { include: { permission: true } } } });
  const groups = Object.entries(PERMISSIONS).reduce<Record<string, { key: string; description: string }[]>>((acc, [key, meta]) => {
    if (selected === "driver" ? key !== "driver.portal" : key === "driver.portal") return acc;
    (acc[meta.group] ??= []).push({ key, description: meta.description });
    return acc;
  }, {});
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">{Object.entries(SYSTEM_ROLES).map(([k, r]) => <a key={k} href={`/admin/settings?tab=roles&role=${k}`} className={`rounded-md border px-3 py-1.5 text-[13px] ${k === selected ? "border-brand bg-brand-soft text-brand" : "hover:bg-subtle"}`}>{r.name}</a>)}</div>
      {role && (
        <Card>
          <CardHeader title={role.name} description={role.description ?? undefined} />
          <CardBody>
            {selected === "super_admin" ? <p className="text-sm text-muted-foreground">Super admins hold every staff permission. This role cannot be edited.</p> : <RolePermissionsForm roleKey={selected} groups={Object.entries(groups).map(([group, perms]) => ({ group, perms }))} granted={role.permissions.map((p) => p.permission.key as Permission)} disabled={!canEdit} />}
            {!canEdit && <p className="mt-3 text-[12px] text-muted-foreground">Only super admins can change role permissions.</p>}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
