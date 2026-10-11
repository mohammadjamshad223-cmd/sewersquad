import Link from "next/link";
import { notFound } from "next/navigation";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { buildManifestData, missingRequiredFields, templateFields, type ManifestData } from "@/server/services/manifests";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, DescriptionList, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionButton } from "@/components/ui/form";
import { DocLink } from "@/components/portal/doc-link";
import { finalizeManifestAction } from "@/app/admin/_actions/billing";
import { formatDateKey, formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { AuditTrail } from "@/components/admin/audit-trail";
import { CorrectionForm, OfficialUploadForm } from "./correction-form";

export const metadata = { title: "Manifest" };

export default async function ManifestDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ v?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const actor = await requireStaffPage("manifests.read");
  const m = await prisma.manifest.findUnique({ where: { id }, include: { template: true, job: { select: { id: true, jobNumber: true, status: true } }, organization: { select: { id: true, name: true } }, location: { select: { id: true, name: true } }, versions: { orderBy: { version: "desc" } }, signatures: { orderBy: { signedAt: "desc" } }, documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } } } });
  if (!m) notFound();
  const tz = await companyTimeZone();
  const viewing = m.versions.find((v) => String(v.version) === sp.v) ?? m.versions[0];
  const data = viewing?.data as unknown as ManifestData | undefined;
  const fields = templateFields(m.template);
  const live = await buildManifestData(prisma, m.jobId);
  const missing = missingRequiredFields(fields, live);
  const canReview = hasPermission(actor, "manifests.review");
  const finalizable = ["SUBMITTED", "PENDING_REVIEW", "APPROVED"].includes(m.status);
  const latestFinal = m.versions.find((v) => v.isFinal);
  const authors = await prisma.user.findMany({ where: { id: { in: m.versions.map((v) => v.createdById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-2">{m.manifestNumber}<StatusBadge kind="manifest" status={m.status} /></span>}
        description={`${m.location.name} · ${m.organization.name} · service ${formatDateKey(m.serviceDate, "long")}`}
        breadcrumbs={[{ label: "Manifests", href: "/admin/manifests" }, { label: m.manifestNumber }]}
        actions={<><Link href={`/admin/jobs/${m.job.id}`} className="text-[13px] font-medium text-brand hover:underline">Job {m.job.jobNumber}</Link>{canReview && finalizable && m.job.status === "COMPLETED" && <ActionButton action={finalizeManifestAction.bind(null, m.id)} successMessage="Manifest finalized and shared with the customer." disabled={missing.length > 0}>Finalize revision</ActionButton>}</>}
      />
      {m.status === "PENDING_REVIEW" && m.job.status === "SUBMITTED" && <Alert tone="warning" title="Awaiting job approval">Approve the job to finalize this manifest, or send it back to the driver.</Alert>}
      {m.status === "REJECTED" && <Alert tone="danger" title="Sent back for correction">{m.rejectionReason}</Alert>}
      {missing.length > 0 && <Alert tone="warning" title="Required by template but missing">{missing.map((f) => `${f.label} (${f.source})`).join(", ")}</Alert>}
      {latestFinal && m.status !== "FINALIZED" && <Alert tone="info">Customers continue to see finalized version {latestFinal.version} until this revision is finalized.</Alert>}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          {data && (
            <Card>
              <CardHeader title={`Version ${viewing!.version}${viewing!.isFinal ? " · finalized" : ""}`} description={`${viewing!.reason ?? ""} · ${formatInstant(viewing!.createdAt, tz)} · hash ${viewing!.contentHash.slice(0, 12)}`} action={viewing!.pdfDocumentId && <DocLink id={viewing!.pdfDocumentId}>PDF</DocLink>} />
              <CardBody className="space-y-6">
                <Section title="Generator" source="Account records" items={[["Business", data.generator.businessName], ["Customer", `${data.generator.organizationName} (${data.generator.accountNumber})`], ["Address", data.generator.address], ["County", data.generator.county], ["Contact", [data.generator.contactName, data.generator.contactPhone].filter(Boolean).join(" · ")]]} />
                <div>
                  <Section title="Collection" source="Driver-entered" items={[["Waste type", data.collection.wasteType], ["Total gallons", `${data.collection.totalGallons.toLocaleString()} gal`], ["Started", data.collection.startedAt ? formatInstant(data.collection.startedAt, tz) : null], ["Completed", data.collection.finishedAt ? formatInstant(data.collection.finishedAt, tz) : null]]} />
                  <Table className="mt-3"><THead><tr><TH>Asset</TH><TH>Type</TH><TH className="text-right">Capacity</TH><TH className="text-right">Pumped</TH></tr></THead><TBody>{data.collection.equipment.map((e) => <TR key={e.assetTag}><TD className="font-mono text-[12.5px]">{e.assetTag}</TD><TD>{e.type}</TD><TD className="text-right tabular-nums">{e.capacityGallons.toLocaleString()}</TD><TD className="text-right tabular-nums">{e.gallonsPumped.toLocaleString()}</TD></TR>)}</TBody></Table>
                </div>
                <Section title="Hauler / transporter" source="Company & fleet records" items={[["Hauler", data.hauler.name], ["Transporter permit", data.hauler.transporterPermitNumber], ["Driver", data.hauler.driverName], ["Truck", data.hauler.truckUnit], ["VIN", data.hauler.vin], ["Vehicle permit", data.hauler.vehiclePermit]]} />
                <Section title="Disposal" source="Disposal records" items={[["Facility", data.disposal.facilityName], ["Facility permit", data.disposal.facilityPermit], ["Disposed", data.disposal.disposedAt ? formatInstant(data.disposal.disposedAt, tz) : null], ["Ticket", data.disposal.ticketNumber], ["Facility acknowledgment", data.disposal.facilityAcknowledged ? "Recorded" : "Not recorded"]]} />
                <Section title="Signatures" source="Customer acknowledgment & driver certification" items={[["Customer", data.signatures.customer ? (data.signatures.customer.unavailable ? `Unavailable — ${data.signatures.customer.unavailableReason}` : `${data.signatures.customer.name}${data.signatures.customer.title ? `, ${data.signatures.customer.title}` : ""}`) : null], ["Driver", data.signatures.driver?.name ?? null]]} />
                <Section title="Administrator verification" source="Office" items={[["Verified by", data.verification.verifiedBy], ["Verified at", data.verification.verifiedAt ? formatInstant(data.verification.verifiedAt, tz) : null], ...Object.entries(data.extra)]} />
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Version history" description="Versions are immutable; corrections add a new version." />
            <CardBody className="space-y-2 p-2">
              {m.versions.map((v) => (
                <Link key={v.id} href={`/admin/manifests/${m.id}?v=${v.version}`} className={`block rounded-md px-3 py-2 text-[13px] hover:bg-subtle ${v.id === viewing?.id ? "bg-brand-soft/60" : ""}`}>
                  <div className="flex items-center justify-between"><span className="font-medium">Version {v.version}</span>{v.isFinal && <Badge tone="success">Finalized</Badge>}</div>
                  <p className="text-muted-foreground">{v.reason} · {authors.find((a) => a.id === v.createdById)?.name ?? "System"} · {formatInstant(v.createdAt, tz)}</p>
                </Link>
              ))}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Documents" />
            <CardBody className="space-y-2 text-[13px]">
              {m.documents.filter((d) => d.type !== "SIGNATURE").map((d) => <div key={d.id} className="flex items-center justify-between gap-2"><span>{d.title} <Badge>{d.visibility === "CUSTOMER" ? "Customer" : "Internal"}</Badge></span><DocLink id={d.id} /></div>)}
              {canReview && <div className="border-t pt-3"><OfficialUploadForm manifestId={m.id} /></div>}
            </CardBody>
          </Card>
          {canReview && m.job.status === "COMPLETED" && (
            <Card>
              <CardHeader title="Correct manifest" description="Creates an auditable revision; the finalized original is preserved." />
              <CardBody><CorrectionForm manifestId={m.id} extra={live.extra} /></CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Template" />
            <CardBody className="text-[13px]"><p className="font-medium">{m.template?.name ?? "Default fields"}</p><p className="text-muted-foreground">{m.template?.jurisdiction} · {fields.filter((f) => f.required).length} required fields</p><Link href="/admin/settings?tab=templates" className="mt-1 inline-block text-brand hover:underline">Manage templates</Link></CardBody>
          </Card>
        </div>
      </div>
      {hasPermission(actor, "audit.read") && <AuditTrail where={{ entityType: "Manifest", entityId: m.id }} title="Manifest audit trail" />}
    </div>
  );
}

function Section({ title, source, items }: { title: string; source: string; items: [string, string | null | undefined][] }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between border-b pb-1"><h3 className="text-[13px] font-semibold uppercase tracking-wide text-brand">{title}</h3><span className="text-[11px] text-muted-foreground">Source: {source}</span></div>
      <DescriptionList columns={3} items={items.map(([label, value]) => ({ label, value: value || <span className="text-muted-foreground">—</span> }))} />
    </section>
  );
}
