import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { companyTimeZone, getSetting } from "@/server/services/settings";
import { customerPickerData } from "@/server/services/paperwork-data";
import { SERVICE_TITLE } from "@/server/services/invoices";
import { isUuid } from "@/server/params";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ReportEditor } from "@/components/admin/report-editor";
import { keyFromDate, todayKey } from "@/lib/dates";
import { REPORT_PRESETS } from "../presets";

export const metadata = { title: "New service report" };

export default async function NewReport({ searchParams }: { searchParams: Promise<{ job?: string; invoice?: string }> }) {
  await requireStaffPage("jobs.write");
  const sp = await searchParams;
  const [orgs, tz, company] = await Promise.all([customerPickerData(), companyTimeZone(), getSetting("company")]);
  const job = sp.job && isUuid(sp.job) ? await prisma.job.findUnique({ where: { id: sp.job }, include: { location: true, invoices: { select: { id: true }, take: 1 } } }) : null;
  const invoice = !job && sp.invoice && isUuid(sp.invoice) ? await prisma.invoice.findUnique({ where: { id: sp.invoice }, include: { serviceLocation: true } }) : null;
  const loc = job?.location ?? invoice?.serviceLocation ?? null;
  const contact = [company.phone && `Call ${company.phone}`, company.email && `email ${company.email}`].filter(Boolean).join(" or ");
  return (
    <div>
      <PageHeader title="New service report" breadcrumbs={[{ label: "Service Reports", href: "/admin/service-reports" }, { label: "New" }]} />
      <Card><CardBody>
        <ReportEditor
          orgs={orgs}
          presets={REPORT_PRESETS}
          init={{
            organizationId: job?.organizationId ?? invoice?.organizationId ?? "",
            locationId: loc?.id ?? "",
            jobId: job?.id ?? "",
            invoiceId: job?.invoices[0]?.id ?? invoice?.id ?? "",
            preparedFor: loc?.name ?? "",
            addressLine1: loc?.addressLine1 ?? "",
            city: loc?.city ?? "Houston",
            state: loc?.state ?? "TX",
            postalCode: loc?.postalCode ?? "",
            serviceDate: job ? keyFromDate(job.scheduledDate) : invoice?.serviceDate ? keyFromDate(invoice.serviceDate) : todayKey(tz),
            subject: job ? `${SERVICE_TITLE[job.serviceType] ?? "Service"} & Findings` : invoice?.serviceTitle ? `${invoice.serviceTitle} & Findings` : "",
            closing: contact ? `We would be glad to schedule this service. ${contact} to book — our team is ready when you are.` : "",
            sections: [REPORT_PRESETS[0]!, REPORT_PRESETS[2]!, REPORT_PRESETS[3]!, REPORT_PRESETS[6]!],
          }}
        />
      </CardBody></Card>
    </div>
  );
}
