import type { DocumentType, Prisma } from "@prisma/client";
import { FileArchive, FileText } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { SelectAll, SelectionCount } from "@/components/portal/select-table";
import { formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { titleCase } from "@/lib/utils";
import { DocActions, UploadDialog } from "./doc-forms";

export const metadata = { title: "Documents" };
const TYPES: DocumentType[] = ["MANIFEST", "MANIFEST_OFFICIAL", "INVOICE", "RECEIPT", "DISPOSAL_TICKET", "SERVICE_PHOTO", "SIGNATURE", "CONTRACT", "AGREEMENT", "PERMIT", "INSPECTION", "EQUIPMENT_PHOTO", "SUPPORT_ATTACHMENT", "OTHER"];
const GENERATED: DocumentType[] = ["MANIFEST", "INVOICE", "RECEIPT", "SIGNATURE"];

export default async function Documents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("documents.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const tz = await companyTimeZone();
  const where: Prisma.DocumentWhereInput = {
    deletedAt: null,
    ...(TYPES.includes(sp.type as DocumentType) ? { type: sp.type as DocumentType } : {}),
    ...(sp.visibility ? { visibility: sp.visibility as "INTERNAL" | "CUSTOMER" } : {}),
    ...(sp.org ? { organizationId: sp.org } : {}),
    ...(sp.q ? { OR: [{ title: { contains: sp.q, mode: "insensitive" } }, { organization: { name: { contains: sp.q, mode: "insensitive" } } }, { location: { name: { contains: sp.q, mode: "insensitive" } } }] } : {}),
  };
  const [items, total, orgs] = await Promise.all([
    prisma.document.findMany({ where, include: { organization: { select: { name: true } }, location: { select: { name: true } }, job: { select: { jobNumber: true } }, versions: { orderBy: { version: "desc" }, take: 1 } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 30, take: 30 }),
    prisma.document.count({ where }),
    prisma.organization.findMany({ where: { deletedAt: null }, select: { id: true, name: true, locations: { where: { deletedAt: null }, select: { id: true, name: true } } }, orderBy: { name: "asc" } }),
  ]);
  const uploaders = await prisma.user.findMany({ where: { id: { in: items.map((i) => i.uploadedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  return (
    <div>
      <PageHeader title="Documents" description="Private document repository. Files are only served through authorized, short-lived downloads." actions={hasPermission(actor, "documents.write") && <UploadDialog orgs={orgs} />} />
      <Card>
        <FilterBar search={{ placeholder: "Title, customer, location" }} selects={[{ param: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: titleCase(t) })) }, { param: "visibility", label: "Visibility", options: [{ value: "CUSTOMER", label: "Shared with customer" }, { value: "INTERNAL", label: "Internal" }] }, { param: "org", label: "Customer", options: orgs.map((o) => ({ value: o.id, label: o.name })) }]} />
        {items.length === 0 ? <EmptyState icon={FileText} title="No documents found" /> : (
          <form action="/api/documents/zip" method="post">
            <Table>
              <THead><tr><TH className="w-10"><SelectAll name="ids" /></TH><TH>Document</TH><TH>Type</TH><TH className="hidden md:table-cell">Customer / location</TH><TH>Visibility</TH><TH className="hidden lg:table-cell">Uploaded</TH><TH className="text-right">Ver.</TH><TH className="text-right">Actions</TH></tr></THead>
              <TBody>
                {items.map((d) => (
                  <TR key={d.id}>
                    <TD><input type="checkbox" name="ids" value={d.id} aria-label={`Select ${d.title}`} className="h-4 w-4 accent-[hsl(var(--brand))]" /></TD>
                    <TD className="max-w-xs"><span className="block truncate font-medium">{d.title}</span><span className="text-[12px] text-muted-foreground">{d.versions[0]?.fileName}{d.job ? ` · ${d.job.jobNumber}` : ""}</span></TD>
                    <TD><Badge>{titleCase(d.type)}</Badge></TD>
                    <TD className="hidden md:table-cell text-[13px]">{d.organization?.name ?? "Company"}<span className="block text-muted-foreground">{d.location?.name}</span></TD>
                    <TD><Badge tone={d.visibility === "CUSTOMER" ? "brand" : "neutral"}>{d.visibility === "CUSTOMER" ? "Customer" : "Internal"}</Badge></TD>
                    <TD className="hidden lg:table-cell whitespace-nowrap text-[13px]">{formatInstant(d.createdAt, tz, "date")}<span className="block text-muted-foreground">{uploaders.find((u) => u.id === d.uploadedById)?.name ?? "System"}</span></TD>
                    <TD className="text-right tabular-nums">{d.currentVersion}</TD>
                    <TD className="whitespace-nowrap text-right"><span className="inline-flex items-center gap-2"><DocLink id={d.id} download={false}>View</DocLink><DocLink id={d.id} /></span><DocActions id={d.id} visibility={d.visibility} canWrite={hasPermission(actor, "documents.write") && d.type !== "SIGNATURE"} canDelete={hasPermission(actor, "documents.delete")} replaceable={!GENERATED.includes(d.type)} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex items-center justify-between border-t px-4 py-3"><SelectionCount name="ids" /><Button type="submit" variant="secondary" size="sm"><FileArchive /> Download selected (ZIP)</Button></div>
          </form>
        )}
        <Pagination page={page} pageSize={30} total={total} searchParams={sp} basePath="/admin/documents" />
      </Card>
    </div>
  );
}
