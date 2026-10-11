import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { InvoiceEditor } from "@/components/admin/invoice-editor";

export const metadata = { title: "New invoice" };

export default async function NewInvoice() {
  await requireStaffPage("invoices.write");
  const [orgs, billing] = await Promise.all([
    prisma.organization.findMany({ where: { deletedAt: null, status: "ACTIVE" }, select: { id: true, name: true, locations: { where: { deletedAt: null }, select: { id: true, name: true } }, billingProfiles: { select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
    getSetting("billing"),
  ]);
  return (
    <div>
      <PageHeader title="New invoice" description="Create a manual invoice. Invoices for completed jobs are generated automatically on approval." breadcrumbs={[{ label: "Invoices", href: "/admin/invoices" }, { label: "New" }]} />
      <Card><CardBody><InvoiceEditor orgs={orgs} taxRateBps={billing.defaultTaxRateBps} /></CardBody></Card>
    </div>
  );
}
