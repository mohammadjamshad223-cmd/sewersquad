import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { isUuid } from "@/server/params";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { keyFromDate } from "@/lib/dates";
import { RecordPaymentForm } from "./record-form";

export const metadata = { title: "Record payment" };

export default async function NewPayment({ searchParams }: { searchParams: Promise<{ org?: string; invoice?: string }> }) {
  await requireStaffPage("payments.record");
  const sp = await searchParams;
  const orgId = isUuid(sp.org) ? sp.org : null;
  const [orgs, invoices] = await Promise.all([
    prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    orgId ? prisma.invoice.findMany({ where: { organizationId: orgId, status: { in: ["SENT", "VIEWED", "PARTIALLY_PAID", "OVERDUE"] }, balanceCents: { gt: 0 } }, orderBy: { dueDate: "asc" }, select: { id: true, invoiceNumber: true, dueDate: true, balanceCents: true } }) : Promise.resolve([]),
  ]);
  return (
    <div className="max-w-3xl">
      <PageHeader title="Record payment" description="For checks, cash and other offline payments. Online card/ACH payments are recorded automatically from verified Stripe events." breadcrumbs={[{ label: "Payments", href: "/admin/payments" }, { label: "Record" }]} />
      <Card><CardBody><RecordPaymentForm orgs={orgs} orgId={orgId} invoices={invoices.map((i) => ({ ...i, dueDate: keyFromDate(i.dueDate) }))} preselect={isUuid(sp.invoice) ? sp.invoice : null} /></CardBody></Card>
    </div>
  );
}
