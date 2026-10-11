import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { OrganizationForm } from "@/components/admin/customer-forms";

export const metadata = { title: "New customer" };

export default async function NewCustomer() {
  await requireStaffPage("customers.write");
  const reps = await prisma.user.findMany({ where: { kind: "STAFF", status: "ACTIVE" }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  return (
    <div className="max-w-3xl">
      <PageHeader title="New customer" description="Create the organization first, then add its service locations and equipment." breadcrumbs={[{ label: "Customers", href: "/admin/customers" }, { label: "New" }]} />
      <Card><CardBody><OrganizationForm reps={reps} /></CardBody></Card>
    </div>
  );
}
