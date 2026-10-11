import { customerContext } from "@/server/customer-context";
import { prisma } from "@/server/db";
import { AccountSettings } from "@/components/portal/account-settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ORG_ROLE_LABEL } from "@/lib/status";

export const metadata = { title: "Account settings" };

export default async function CustomerSettings() {
  const { actor, scope } = await customerContext();
  const adminOrgs = scope.orgAdminOrgIds;
  const [orgs, members] = await Promise.all([
    prisma.organization.findMany({ where: { id: { in: scope.orgIds } }, include: { billingProfiles: { where: { isDefault: true } } } }),
    adminOrgs.length
      ? prisma.organizationMembership.findMany({ where: { organizationId: { in: adminOrgs } }, include: { user: { select: { name: true, email: true, status: true, locationMemberships: { select: { location: { select: { name: true } } } } } } }, orderBy: { user: { name: "asc" } } })
      : Promise.resolve([]),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Account settings" description="Your profile, security, notifications and organization details." />
      {orgs.map((o) => {
        const bp = o.billingProfiles[0];
        return (
          <Card key={o.id}>
            <CardHeader title={o.name} description={`Account ${o.accountNumber}`} action={<Badge tone="brand">{ORG_ROLE_LABEL[scope.organizations.find((x) => x.id === o.id)?.role ?? "READ_ONLY"]}</Badge>} />
            <CardBody className="grid gap-4 text-sm sm:grid-cols-3">
              <div><p className="text-[12px] uppercase tracking-wide text-muted-foreground">Billing</p><p className="mt-1">{o.billingMode === "CONSOLIDATED" ? "Consolidated (one account)" : "Billed per location"}</p></div>
              <div><p className="text-[12px] uppercase tracking-wide text-muted-foreground">Billing contact</p><p className="mt-1">{bp?.billingEmail ?? o.primaryEmail ?? "—"}</p></div>
              <div><p className="text-[12px] uppercase tracking-wide text-muted-foreground">Payment terms</p><p className="mt-1">{bp ? `Net ${bp.paymentTermsDays}` : "—"}</p></div>
              <p className="text-[13px] text-muted-foreground sm:col-span-3">To change billing details or add users, <a href="/customer/support/new?category=BILLING" className="font-medium text-brand hover:underline">send us a request</a> — changes are verified by our office.</p>
            </CardBody>
          </Card>
        );
      })}
      {members.length > 0 && (
        <Card>
          <CardHeader title="Users in your organization" description="Visible to organization admins." />
          <Table>
            <THead><tr><TH>Name</TH><TH>Role</TH><TH className="hidden md:table-cell">Locations</TH><TH>Status</TH></tr></THead>
            <TBody>
              {members.map((m) => (
                <TR key={m.id}>
                  <TD><p className="font-medium">{m.user.name}</p><p className="text-[12px] text-muted-foreground">{m.user.email}</p></TD>
                  <TD>{ORG_ROLE_LABEL[m.role]}</TD>
                  <TD className="hidden md:table-cell text-[13px]">{m.role === "ORG_ADMIN" ? "All locations" : m.user.locationMemberships.map((l) => l.location.name).join(", ")}</TD>
                  <TD><Badge tone={m.user.status === "ACTIVE" ? "success" : "neutral"}>{m.user.status.toLowerCase()}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <AccountSettings actor={actor} />
    </div>
  );
}
