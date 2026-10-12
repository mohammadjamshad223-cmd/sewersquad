import { FileArchive, FileText } from "lucide-react";
import type { DocumentType } from "@prisma/client";
import { customerContext } from "@/server/customer-context";
import { customerDocumentsWhere } from "@/server/services/documents";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { DocLink } from "@/components/portal/doc-link";
import { SelectAll } from "@/components/portal/select-table";
import { formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Documents" };
const TYPES: DocumentType[] = ["MANIFEST", "MANIFEST_OFFICIAL", "INVOICE", "RECEIPT", "SERVICE_PHOTO", "CONTRACT", "AGREEMENT", "PERMIT", "PROPOSAL", "SERVICE_REPORT", "OTHER"];

export default async function Documents({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { scope, selectedLocationId } = await customerContext();
  const type = TYPES.includes(sp.type as DocumentType) ? (sp.type as DocumentType) : undefined;
  const where = customerDocumentsWhere(scope, selectedLocationId, { type, q: sp.q });
  const [items, total, tz] = await Promise.all([
    prisma.document.findMany({ where, include: { location: { select: { name: true } }, versions: { orderBy: { version: "desc" }, take: 1, select: { sizeBytes: true, mimeType: true } } }, orderBy: { createdAt: "desc" }, skip: (page - 1) * 25, take: 25 }),
    prisma.document.count({ where }),
    companyTimeZone(),
  ]);
  return (
    <div>
      <PageHeader title="Documents" description="Manifests, invoices, receipts, service photos, agreements and permits shared with your account." />
      <Card>
        <FilterBar search={{ placeholder: "Search documents" }} selects={[{ param: "type", label: "Type", options: TYPES.map((t) => ({ value: t, label: titleCase(t) })) }]} />
        {items.length === 0 ? (
          <EmptyState icon={FileText} title="No documents found" />
        ) : (
          <form action="/api/documents/zip" method="post">
            <Table>
              <THead><tr><TH className="w-10"><SelectAll name="ids" /></TH><TH>Document</TH><TH>Type</TH><TH className="hidden md:table-cell">Location</TH><TH>Added</TH><TH className="hidden sm:table-cell text-right">Size</TH><TH className="text-right">Actions</TH></tr></THead>
              <TBody>
                {items.map((d) => (
                  <TR key={d.id}>
                    <TD><input type="checkbox" name="ids" value={d.id} aria-label={`Select ${d.title}`} className="h-4 w-4 accent-[hsl(var(--brand))]" /></TD>
                    <TD className="font-medium">{d.title}</TD>
                    <TD><Badge>{titleCase(d.type)}</Badge></TD>
                    <TD className="hidden md:table-cell">{d.location?.name ?? "Account"}</TD>
                    <TD className="whitespace-nowrap">{formatInstant(d.createdAt, tz, "date")}</TD>
                    <TD className="hidden sm:table-cell text-right tabular-nums text-[13px] text-muted-foreground">{d.versions[0] ? `${Math.max(1, Math.round(d.versions[0].sizeBytes / 1024))} KB` : ""}</TD>
                    <TD className="whitespace-nowrap text-right">
                      {d.versions[0] && (d.versions[0].mimeType === "application/pdf" || d.versions[0].mimeType.startsWith("image/")) && <DocLink id={d.id} download={false} className="mr-3">Preview</DocLink>}
                      <DocLink id={d.id} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <div className="flex justify-end border-t px-4 py-3"><Button type="submit" variant="secondary" size="sm"><FileArchive /> Download selected (ZIP)</Button></div>
          </form>
        )}
        {total > 25 && <Pagination page={page} pageSize={25} total={total} searchParams={sp} basePath="/customer/documents" />}
      </Card>
    </div>
  );
}
