import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { customerPickerData } from "@/server/services/paperwork-data";
import { reportSections } from "@/server/services/service-reports";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/misc";
import { DocLink } from "@/components/portal/doc-link";
import { ReportEditor } from "@/components/admin/report-editor";
import { FinalizeReportButton } from "@/components/admin/paperwork-actions";
import { formatDateKey, keyFromDate } from "@/lib/dates";
import { REPORT_TONE } from "@/lib/status";
import { REPORT_PRESETS } from "../presets";

export const metadata = { title: "Service report" };

export default async function ReportPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const id = await idParam(params);
  const actor = await requireStaffPage("jobs.read");
  const sp = await searchParams;
  const r = await prisma.serviceReport.findUnique({ where: { id }, include: { documents: { where: { deletedAt: null, type: "SERVICE_REPORT" }, orderBy: { createdAt: "desc" }, take: 1 }, job: { select: { id: true, jobNumber: true } }, invoice: { select: { id: true, invoiceNumber: true } }, organization: { select: { name: true } } } });
  if (!r) notFound();
  const orgs = await customerPickerData();
  const canWrite = hasPermission(actor, "jobs.write");
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3">Service report {r.number} <Badge tone={REPORT_TONE[r.status]}>{r.status === "FINAL" ? "shared" : "draft"}</Badge></span>}
        description={`${r.preparedFor} · ${formatDateKey(r.serviceDate, "long")} · ${r.subject}`}
        breadcrumbs={[{ label: "Service Reports", href: "/admin/service-reports" }, { label: r.number }]}
        actions={<Button asChild variant="secondary"><a href={`/api/pdf/report/${r.id}`} target="_blank" rel="noreferrer"><FileDown /> Preview PDF</a></Button>}
      />
      {sp.created && <Alert tone="success" title="Report created">Preview it, then finalize to share it in the customer&apos;s portal.</Alert>}
      {r.legacySource && <Alert tone="info" title="Imported from your records">Original file: {r.legacySource}</Alert>}
      <Card>
        <CardHeader title="Sharing" action={canWrite && <FinalizeReportButton id={r.id} final={r.status === "FINAL"} />} />
        <CardBody className="space-y-1 text-sm text-muted-foreground">
          <p>{r.documents[0] ? <>Filed PDF: <DocLink id={r.documents[0].id}>{r.documents[0].title}</DocLink>{r.organization ? ` — visible to ${r.organization.name} in their portal.` : " — internal (no customer account linked)."}</> : "Not shared yet. Finalizing files the PDF for you and the customer."}</p>
          {(r.job || r.invoice) && <p>Linked to {r.job && <Link className="text-brand underline" href={`/admin/jobs/${r.job.id}`}>job {r.job.jobNumber}</Link>}{r.job && r.invoice && " · "}{r.invoice && <Link className="text-brand underline" href={`/admin/invoices/${r.invoice.id}`}>invoice {r.invoice.invoiceNumber}</Link>}</p>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Edit report" description={r.status === "FINAL" ? "Saving changes re-files the shared PDF." : undefined} />
        <CardBody>
          {canWrite ? (
            <ReportEditor
              orgs={orgs}
              presets={REPORT_PRESETS}
              init={{ id: r.id, organizationId: r.organizationId ?? "", locationId: r.locationId ?? "", jobId: r.jobId ?? "", invoiceId: r.invoiceId ?? "", preparedFor: r.preparedFor, addressLine1: r.addressLine1, city: r.city, state: r.state, postalCode: r.postalCode, serviceDate: keyFromDate(r.serviceDate), subject: r.subject, closing: r.closing ?? "", sections: reportSections(r.sections) }}
            />
          ) : (
            reportSections(r.sections).map((s) => <div key={s.title} className="mb-4"><p className="font-semibold">{s.title}</p><p className="whitespace-pre-line text-sm">{s.body}</p></div>)
          )}
        </CardBody>
      </Card>
    </div>
  );
}
