import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireStaffPage } from "@/server/authz/guards";
import { idParam } from "@/server/params";
import { prisma } from "@/server/db";
import { proposeJobInvoice } from "@/server/services/invoices";
import { getSetting } from "@/server/services/settings";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { InvoiceEditor } from "@/components/admin/invoice-editor";
import { formatDateKey } from "@/lib/dates";
import { SERVICE_TYPE_LABEL } from "@/lib/status";

export const metadata = { title: "Confirm invoice" };

/** Step after completing a job: the operator checks and adjusts the invoice before it is created and sent. */
export default async function ConfirmJobInvoice({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  await requireStaffPage("invoices.write");
  const p = await proposeJobInvoice(id).catch(() => null);
  if (!p) notFound();
  if (p.invoice) redirect(`/admin/invoices/${p.invoice.id}`);
  const back = sp.from === "dispatch" ? "/admin/dispatch" : `/admin/jobs/${id}`;
  const [billing, profile, org] = await Promise.all([
    getSetting("billing"),
    prisma.billingProfile.findFirst({ where: { organizationId: p.job.organizationId }, orderBy: { isDefault: "desc" } }),
    prisma.organization.findUniqueOrThrow({ where: { id: p.job.organizationId }, select: { id: true, name: true, billingProfiles: { select: { id: true, name: true } } } }),
  ]);
  const taxRateBps = profile?.taxExempt ? 0 : profile?.taxRateBps ?? billing.defaultTaxRateBps;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader
        title="Confirm invoice"
        description={`${p.job.locationName} · ${SERVICE_TYPE_LABEL[p.job.serviceType] ?? "Service"} · ${formatDateKey(p.defaults.serviceDate, "long")}${p.gallons ? ` · ${p.gallons.toLocaleString()} gal pumped` : ""}`}
        breadcrumbs={[{ label: "Jobs", href: "/admin/jobs" }, { label: p.job.jobNumber, href: `/admin/jobs/${id}` }, { label: "Confirm invoice" }]}
      />
      {p.job.status !== "COMPLETED" ? (
        <Alert tone="warning" title="This job isn't completed yet">Complete it from the <Link href="/admin/dispatch" className="underline">dispatch board</Link> or the <Link href={`/admin/jobs/${id}`} className="underline">job page</Link>, then confirm the invoice.</Alert>
      ) : (
        <>
          {p.needsPricing && <Alert tone="warning" title="No price on file for this customer">Enter the price on the highlighted line before confirming.</Alert>}
          <Card>
            <CardBody>
              <InvoiceEditor
                orgs={[{ id: org.id, name: org.name, locations: [], billingProfiles: org.billingProfiles }]}
                taxRateBps={taxRateBps}
                manifestFeeBps={billing.manifestFeeBps}
                confirmJob={{ jobId: id, locationId: p.job.locationId, locationName: p.job.locationName, redirectTo: back }}
                disposal={{ defaultCents: p.defaults.disposalCentsPerGallon, averageCents: p.averageDisposalCents, gallons: p.gallons, hauls: p.hauls }}
                invoice={{ id: "", organizationId: org.id, serviceLocationId: p.job.locationId, billingProfileId: null, serviceDate: p.defaults.serviceDate, paymentTermsDays: profile?.paymentTermsDays ?? billing.defaultPaymentTermsDays, poNumber: profile?.poNumber ?? null, serviceTitle: p.defaults.serviceTitle, nextServiceDate: p.defaults.nextServiceDate, notes: null, lines: p.defaults.lines }}
              />
            </CardBody>
          </Card>
          <p className="text-[13px] text-muted-foreground">Not ready? <Link href={back} className="font-medium text-brand hover:underline">Do it later</Link> — the job stays on the dispatch board under “Completed today” with a Confirm invoice button, and nothing is sent until you confirm.</p>
        </>
      )}
    </div>
  );
}
