import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { idParam } from "@/server/params";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { getSetting } from "@/server/services/settings";
import { customerPickerData } from "@/server/services/paperwork-data";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, PageHeader } from "@/components/ui/misc";
import { DocLink } from "@/components/portal/doc-link";
import { ProposalEditor } from "@/components/admin/proposal-editor";
import { ProposalStatusActions } from "@/components/admin/paperwork-actions";
import { keyFromDate, formatDateKey } from "@/lib/dates";
import { PROPOSAL_TONE } from "@/lib/status";

export const metadata = { title: "Proposal" };

export default async function ProposalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const id = await idParam(params);
  const actor = await requireStaffPage("invoices.read");
  const sp = await searchParams;
  const p = await prisma.proposal.findUnique({
    where: { id },
    include: { sections: { orderBy: { sortOrder: "asc" }, include: { lines: { orderBy: { sortOrder: "asc" } } } }, documents: { where: { deletedAt: null, type: "PROPOSAL" }, orderBy: { createdAt: "desc" }, take: 1 }, organization: { select: { id: true, name: true } } },
  });
  if (!p) notFound();
  const [orgs, billing] = await Promise.all([customerPickerData(), getSetting("billing")]);
  const word = p.kind === "QUOTE" ? "Quote" : "Proposal";
  const canWrite = hasPermission(actor, "invoices.write");
  const closed = p.status === "ACCEPTED" || p.status === "DECLINED";
  const money = (c: string) => (Number(c) / 100).toFixed(Number(c) % 1 ? 4 : 2).replace(/^-/, "");
  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3">{word} {p.number} <Badge tone={PROPOSAL_TONE[p.status]}>{p.status.toLowerCase()}</Badge></span>}
        description={`${p.preparedFor} · ${formatDateKey(p.date, "long")}${p.organization ? ` · customer ${p.organization.name}` : " · prospect"}`}
        breadcrumbs={[{ label: "Proposals & Quotes", href: "/admin/proposals" }, { label: p.number }]}
        actions={<Button asChild variant="secondary"><a href={`/api/pdf/proposal/${p.id}`} target="_blank" rel="noreferrer"><FileDown /> Preview PDF</a></Button>}
      />
      {sp.created && <Alert tone="success" title={`${word} created`}>Preview the PDF, then mark it sent when you send it to the customer.</Alert>}
      {p.legacySource && <Alert tone="info" title="Imported from your records">Original file: {p.legacySource}</Alert>}
      <Card>
        <CardHeader title="Status" description={p.status === "SENT" ? `Sent ${p.sentAt ? formatDateKey(keyFromDate(p.sentAt)) : ""}. Record the customer's answer.` : p.decisionNote ?? undefined} action={canWrite && <ProposalStatusActions id={p.id} status={p.status} word={word.toLowerCase()} />} />
        <CardBody className="text-sm text-muted-foreground">
          {p.documents[0] ? <>Filed PDF: <DocLink id={p.documents[0].id}>{p.documents[0].title}</DocLink>{p.organization ? " (visible in the customer's portal)" : " (internal — prospect has no portal)"}</> : "Marking it sent files the PDF in your documents (and the customer's portal when it's for an existing customer)."}
          {p.status === "ACCEPTED" && p.organization && <> · <Link href={`/admin/jobs/new?org=${p.organization.id}`} className="text-brand underline">Schedule the job</Link></>}
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={closed ? `${word} (closed)` : `Edit ${word.toLowerCase()}`} />
        <CardBody>
          <ProposalEditor
            locked={!canWrite || closed}
            manifestFeeBps={billing.manifestFeeBps}
            orgs={orgs}
            init={{
              id: p.id,
              kind: p.kind,
              organizationId: p.organizationId ?? "",
              locationId: p.locationId ?? "",
              preparedFor: p.preparedFor,
              addressLine1: p.addressLine1,
              city: p.city,
              state: p.state,
              postalCode: p.postalCode,
              date: keyFromDate(p.date),
              scopeTitle: p.scopeTitle,
              scopeSubtitle: p.scopeSubtitle ?? "",
              intro: p.intro ?? "",
              note: p.note ?? "",
              priceNote: p.priceNote ?? "",
              sections: p.sections.map((s) => ({ title: s.title ?? "", subtotalLabel: s.subtotalLabel ?? "", lines: s.lines.map((l) => ({ kind: l.kind, description: l.description, quantity: l.quantity.toString(), unitPrice: money(l.unitPriceCents.toString()) })) })),
            }}
          />
        </CardBody>
      </Card>
    </div>
  );
}
