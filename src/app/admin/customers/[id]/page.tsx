import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, DescriptionList, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Tabs } from "@/components/ui/tabs";
import { ActionButton } from "@/components/ui/form";
import { BillingDialog, ContactDialog, InviteUserDialog, LocationDialog, OrgDialog, ReasonDialog } from "@/components/admin/dialogs";
import { copyAccessLinkAction, deleteContactAction, removeMembershipAction, sendAccessLinkAction, setOrganizationStatusAction, setUserActiveAction } from "@/app/admin/_actions/customers";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { ORG_ROLE_LABEL } from "@/lib/status";
import { formatAddress, titleCase } from "@/lib/utils";
import { companyTimeZone } from "@/server/services/settings";
import { withLocationLabels } from "@/lib/location-label";
import { AuditTrail } from "@/components/admin/audit-trail";

export const metadata = { title: "Customer" };

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; created?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("customers.read");
  const org = await prisma.organization.findFirst({
    where: { id, deletedAt: null },
    include: {
      accountRep: { select: { name: true } },
      locations: { where: { deletedAt: null }, orderBy: { name: "asc" }, include: { _count: { select: { assets: { where: { deletedAt: null } } } }, plans: { where: { status: "ACTIVE" }, select: { nextServiceDate: true } } } },
      contacts: { include: { location: { select: { name: true } } }, orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      billingProfiles: { orderBy: [{ isDefault: "desc" }, { name: "asc" }] },
      memberships: { include: { user: { select: { id: true, name: true, email: true, status: true, lastLoginAt: true, locationMemberships: { select: { location: { select: { id: true, name: true, organizationId: true } } } } } } } },
    },
  });
  if (!org) notFound();
  const tab = sp.tab ?? "overview";
  const tz = await companyTimeZone();
  const canWrite = hasPermission(actor, "customers.write");
  const [reps, balance, jobs, invoices] = await Promise.all([
    prisma.user.findMany({ where: { kind: "STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.invoice.aggregate({ where: { organizationId: id, status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] } }, _sum: { balanceCents: true }, _count: true }),
    tab === "history" || tab === "overview" ? prisma.job.findMany({ where: { organizationId: id }, orderBy: { scheduledDate: "desc" }, take: tab === "overview" ? 6 : 100, include: { location: { select: { name: true } } } }) : Promise.resolve([]),
    tab === "invoices" ? prisma.invoice.findMany({ where: { organizationId: id }, orderBy: { issueDate: "desc" }, take: 100, include: { serviceLocation: { select: { name: true } } } }) : Promise.resolve([]),
  ]);
  const locOptions = withLocationLabels(org.locations).map((l) => ({ id: l.id, name: l.label }));
  return (
    <div>
      <PageHeader
        title={<span className="flex items-center gap-2">{org.name}{org.isDemo && <Badge>Demo data</Badge>}</span>}
        description={`${org.accountNumber} · ${titleCase(org.type)} · ${org.billingMode === "CONSOLIDATED" ? "Consolidated billing" : "Per-location billing"}`}
        breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: org.name }]}
        actions={
          <>
            <Badge tone={org.status === "ACTIVE" ? "success" : "neutral"} dot>{titleCase(org.status)}</Badge>
            {canWrite && <OrgDialog trigger={{ label: "Edit", icon: "edit" }} org={{ id: org.id, name: org.name, type: org.type, billingMode: org.billingMode, primaryEmail: org.primaryEmail, primaryPhone: org.primaryPhone, website: org.website, notes: org.notes, accountRepId: org.accountRepId }} reps={reps} />}
            {hasPermission(actor, "customers.deactivate") && (
              <ReasonDialog
                trigger={{ label: org.status === "ACTIVE" ? "Deactivate" : "Reactivate", variant: org.status === "ACTIVE" ? "danger-outline" : "secondary" }}
                title={org.status === "ACTIVE" ? "Deactivate account" : "Reactivate account"}
                description={org.status === "ACTIVE" ? "Active recurring plans will be paused and portal users lose access to this organization. History is preserved." : undefined}
                action={setOrganizationStatusAction}
                hidden={{ id: org.id, active: org.status === "ACTIVE" ? "false" : "true" }}
                reasonRequired={org.status === "ACTIVE"}
                submitLabel={org.status === "ACTIVE" ? "Deactivate" : "Reactivate"}
                submitVariant={org.status === "ACTIVE" ? "danger" : "primary"}
              />
            )}
          </>
        }
      />
      {sp.created && <Alert tone="success" title="Customer created" className="mb-5">Next, add a service location and its equipment.</Alert>}
      <Tabs basePath={`/admin/customers/${org.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "locations", label: "Locations", count: org.locations.length }, { key: "contacts", label: "Contacts", count: org.contacts.length }, { key: "billing", label: "Billing", count: org.billingProfiles.length }, { key: "users", label: "Portal users", count: org.memberships.length }, { key: "history", label: "Service history" }, { key: "invoices", label: "Invoices" }, { key: "activity", label: "Activity" }]} />

      {tab === "overview" && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Open balance" value={formatCents(balance._sum.balanceCents ?? 0)} hint={`${balance._count} open invoices`} href={`/admin/invoices?org=${org.id}`} />
            <Stat label="Service locations" value={org.locations.length} />
            <Stat label="Next service" value={(() => { const d = org.locations.flatMap((l) => l.plans.map((p) => p.nextServiceDate)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime())[0]; return d ? formatDateKey(d) : "—"; })()} />
          </div>
          <Card>
            <CardBody>
              <DescriptionList columns={3} items={[{ label: "Primary email", value: org.primaryEmail }, { label: "Primary phone", value: org.primaryPhone }, { label: "Account rep", value: org.accountRep?.name }, { label: "Website", value: org.website }, { label: "Stripe customer", value: org.stripeCustomerId ?? "Created on first online payment" }, { label: "Customer since", value: formatInstant(org.createdAt, tz, "date") }, { label: "Internal notes", value: org.notes }]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent jobs" action={<Link href={`/admin/customers/${org.id}?tab=history`} className="text-[13px] font-medium text-brand hover:underline">All history</Link>} />
            <JobsTable jobs={jobs} />
          </Card>
        </div>
      )}

      {tab === "locations" && (
        <Card>
          <CardHeader title="Service locations" action={canWrite && <LocationDialog trigger={{ label: "Add location", icon: "plus", variant: "primary" }} title="Add service location" organizationId={org.id} billingProfiles={org.billingProfiles} />} />
          {org.locations.length === 0 ? <EmptyState title="No locations yet" /> : (
            <Table>
              <THead><tr><TH>Location</TH><TH>Address</TH><TH className="text-right">Equipment</TH><TH>Next service</TH><TH>Status</TH></tr></THead>
              <TBody>
                {org.locations.map((l) => (
                  <TR key={l.id}>
                    <TD><Link href={`/admin/locations/${l.id}`} className="font-medium hover:text-brand">{l.name}</Link><span className="block font-mono text-[12px] text-muted-foreground">{l.code}</span></TD>
                    <TD className="text-[13px]">{formatAddress(l)}</TD>
                    <TD className="text-right tabular-nums">{l._count.assets}</TD>
                    <TD>{l.plans[0]?.nextServiceDate ? formatDateKey(l.plans[0].nextServiceDate) : "—"}</TD>
                    <TD><Badge tone={l.status === "ACTIVE" ? "success" : "neutral"} dot>{titleCase(l.status)}</Badge></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>
      )}

      {tab === "contacts" && (
        <Card>
          <CardHeader title="Contacts" action={canWrite && <ContactDialog trigger={{ label: "Add contact", icon: "plus", variant: "primary" }} title="Add contact" organizationId={org.id} locations={locOptions} />} />
          <Table>
            <THead><tr><TH>Name</TH><TH>Email / phone</TH><TH>Location</TH><TH>Roles</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
            <TBody>
              {org.contacts.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}<span className="block text-[12px] font-normal text-muted-foreground">{c.title}</span></TD>
                  <TD className="text-[13px]">{c.email}<span className="block text-muted-foreground">{c.phone}</span></TD>
                  <TD>{c.location?.name ?? "All"}</TD>
                  <TD className="space-x-1">{c.isPrimary && <Badge tone="brand">Primary</Badge>}{c.receivesInvoices && <Badge>Invoices</Badge>}{c.receivesReminders && <Badge>Reminders</Badge>}{c.smsOptedOutAt ? <Badge tone="danger">Texts: STOP</Badge> : c.smsOptIn && <Badge tone="success">Texts on</Badge>}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {canWrite && <><ContactDialog trigger={{ label: "Edit" , variant: "ghost" }} title="Edit contact" organizationId={org.id} locations={locOptions} contact={c} /><ActionButton variant="ghost" size="sm" className="text-danger" confirm="Remove this contact?" action={deleteContactAction.bind(null, org.id, c.id)} successMessage="Contact removed.">Remove</ActionButton></>}
                  </TD>
                </TR>
              ))}
              {org.contacts.length === 0 && <TR><TD colSpan={5} className="py-8 text-center text-muted-foreground">No contacts.</TD></TR>}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "billing" && (
        <Card>
          <CardHeader title="Billing profiles" description="Locations can bill to a specific profile; otherwise the default is used." action={canWrite && <BillingDialog trigger={{ label: "Add profile", icon: "plus", variant: "primary" }} title="Add billing profile" organizationId={org.id} />} />
          <Table>
            <THead><tr><TH>Profile</TH><TH>Billing email</TH><TH>Terms</TH><TH>Tax</TH><TH>Partial payments</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
            <TBody>
              {org.billingProfiles.map((b) => (
                <TR key={b.id}>
                  <TD className="font-medium">{b.name}{b.isDefault && <Badge tone="brand" className="ml-2">Default</Badge>}</TD>
                  <TD>{b.billingEmail ?? "—"}</TD>
                  <TD>Net {b.paymentTermsDays}</TD>
                  <TD>{b.taxExempt ? "Exempt" : b.taxRateBps !== null ? `${(b.taxRateBps / 100).toFixed(2)}%` : "Company default"}</TD>
                  <TD>{b.allowPartialPayments === null ? "Company default" : b.allowPartialPayments ? "Allowed" : "Not allowed"}</TD>
                  <TD className="text-right">{canWrite && <BillingDialog trigger={{ label: "Edit", variant: "ghost" }} title="Edit billing profile" organizationId={org.id} profile={b} />}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "users" && (
        <Card>
          <CardHeader title="Portal users" description="Customers sign in to view services, documents and invoices for the locations they're assigned." action={hasPermission(actor, "customers.users") && <InviteUserDialog trigger={{ label: "Invite user", icon: "plus", variant: "primary" }} organizationId={org.id} locations={locOptions} />} />
          <Table>
            <THead><tr><TH>User</TH><TH>Role</TH><TH>Locations</TH><TH>Payments</TH><TH>Status</TH><TH>Last sign-in</TH><TH className="text-right"><span className="sr-only">Actions</span></TH></tr></THead>
            <TBody>
              {org.memberships.map((m) => (
                <TR key={m.id}>
                  <TD className="font-medium">{m.user.name}<span className="block text-[12px] font-normal text-muted-foreground">{m.user.email}</span></TD>
                  <TD>{ORG_ROLE_LABEL[m.role]}</TD>
                  <TD className="text-[13px]">{m.role === "ORG_ADMIN" ? "All" : m.user.locationMemberships.filter((l) => l.location.organizationId === org.id).map((l) => l.location.name).join(", ") || "None"}</TD>
                  <TD>{m.canPay ? "Can pay" : "View only"}</TD>
                  <TD><Badge tone={m.user.status === "ACTIVE" ? "success" : m.user.status === "INVITED" ? "info" : "neutral"}>{titleCase(m.user.status)}</Badge></TD>
                  <TD className="text-[13px]">{m.user.lastLoginAt ? formatInstant(m.user.lastLoginAt, tz) : "Never"}</TD>
                  <TD className="whitespace-nowrap text-right">
                    {hasPermission(actor, "customers.users") && (
                      <>
                        {m.user.status !== "DEACTIVATED" && <ActionButton variant="ghost" size="sm" action={sendAccessLinkAction.bind(null, m.user.id)} refresh={false}>{m.user.status === "INVITED" ? "Resend invite" : "Send reset link"}</ActionButton>}
                        {m.user.status !== "DEACTIVATED" && <ActionButton variant="ghost" size="sm" action={copyAccessLinkAction.bind(null, m.user.id)} refresh={false} title="Get a link you can text or message to them yourself">{m.user.status === "INVITED" ? "Copy invite link" : "Copy reset link"}</ActionButton>}
                        <ActionButton variant="ghost" size="sm" action={setUserActiveAction.bind(null, m.user.id, m.user.status === "DEACTIVATED")} successMessage="Updated." confirm={m.user.status === "DEACTIVATED" ? undefined : "Deactivate this user? They will be signed out everywhere."}>{m.user.status === "DEACTIVATED" ? "Reactivate" : "Deactivate"}</ActionButton>
                        <ActionButton variant="ghost" size="sm" className="text-danger" action={removeMembershipAction.bind(null, org.id, m.user.id)} confirm="Remove this user's access to this organization?" successMessage="Access removed.">Remove</ActionButton>
                      </>
                    )}
                  </TD>
                </TR>
              ))}
              {org.memberships.length === 0 && <TR><TD colSpan={7} className="py-8 text-center text-muted-foreground">No portal users yet.</TD></TR>}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "history" && <Card><JobsTable jobs={jobs} /></Card>}

      {tab === "invoices" && (
        <Card>
          <Table>
            <THead><tr><TH>Invoice</TH><TH>Issued</TH><TH>Due</TH><TH>Location</TH><TH className="text-right">Total</TH><TH className="text-right">Balance</TH><TH>Status</TH></tr></THead>
            <TBody>
              {invoices.map((i) => (
                <TR key={i.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/invoices/${i.id}`} className="font-medium hover:text-brand">{i.invoiceNumber}</Link></TD>
                  <TD>{formatDateKey(i.issueDate)}</TD><TD>{formatDateKey(i.dueDate)}</TD><TD>{i.serviceLocation?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatCents(i.totalCents)}</TD><TD className="text-right tabular-nums">{formatCents(i.balanceCents)}</TD>
                  <TD><StatusBadge kind="invoice" status={i.status} /></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      {tab === "activity" && hasPermission(actor, "audit.read") && <AuditTrail where={{ organizationId: org.id }} />}
      {tab === "activity" && !hasPermission(actor, "audit.read") && <Alert tone="info">You don&apos;t have permission to view the audit log.</Alert>}
    </div>
  );
}

function JobsTable({ jobs }: { jobs: { id: string; jobNumber: string; scheduledDate: Date; status: string; type: string; location: { name: string } }[] }) {
  if (jobs.length === 0) return <EmptyState title="No jobs yet" />;
  return (
    <Table>
      <THead><tr><TH>Date</TH><TH>Job</TH><TH>Location</TH><TH>Type</TH><TH>Status</TH></tr></THead>
      <TBody>
        {jobs.map((j) => (
          <TR key={j.id}>
            <TD className="whitespace-nowrap">{formatDateKey(j.scheduledDate)}</TD>
            <TD className="whitespace-nowrap"><Link href={`/admin/jobs/${j.id}`} className="font-medium hover:text-brand">{j.jobNumber}</Link></TD>
            <TD>{j.location.name}</TD>
            <TD>{titleCase(j.type)}</TD>
            <TD><StatusBadge kind="job" status={j.status} /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  );
}
