import Link from "next/link";
import { FileSignature, Plus } from "lucide-react";
import type { Prisma, ProposalStatus } from "@prisma/client";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { FilterBar } from "@/components/ui/filters";
import { formatDateKey } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { PROPOSAL_TONE } from "@/lib/status";

export const metadata = { title: "Proposals & Quotes" };

export default async function Proposals({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("invoices.read");
  const sp = await searchParams;
  const status = ["DRAFT", "SENT", "ACCEPTED", "DECLINED"].includes(sp.status ?? "") ? (sp.status as ProposalStatus) : undefined;
  const where: Prisma.ProposalWhereInput = {
    ...(status ? { status } : {}),
    ...(sp.kind === "QUOTE" || sp.kind === "PROPOSAL" ? { kind: sp.kind } : {}),
    ...(sp.q ? { OR: [{ number: { contains: sp.q, mode: "insensitive" } }, { preparedFor: { contains: sp.q, mode: "insensitive" } }, { addressLine1: { contains: sp.q, mode: "insensitive" } }] } : {}),
  };
  const [items, open, won] = await Promise.all([
    prisma.proposal.findMany({ where, orderBy: [{ date: "desc" }, { number: "desc" }], take: 200 }),
    prisma.proposal.aggregate({ where: { status: "SENT" }, _sum: { totalCents: true }, _count: true }),
    prisma.proposal.aggregate({ where: { status: "ACCEPTED" }, _sum: { totalCents: true }, _count: true }),
  ]);
  const canWrite = hasPermission(actor, "invoices.write");
  return (
    <div className="space-y-6">
      <PageHeader title="Proposals & Quotes" description="Priced scopes of work for customers and prospects, printed in your Sewer Squad layout." actions={canWrite && <><Button asChild><Link href="/admin/proposals/new"><Plus /> New proposal</Link></Button><Button asChild variant="secondary"><Link href="/admin/proposals/new?kind=QUOTE"><Plus /> New quote</Link></Button></>} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Stat label="Awaiting an answer" value={formatCents(open._sum.totalCents ?? 0)} hint={`${open._count} sent`} href="/admin/proposals?status=SENT" icon={FileSignature} tone="brand" />
        <Stat label="Accepted" value={formatCents(won._sum.totalCents ?? 0)} hint={`${won._count} accepted`} href="/admin/proposals?status=ACCEPTED" tone="success" />
      </div>
      <Card>
        <FilterBar search={{ placeholder: "Number, business or address" }} selects={[{ param: "status", label: "Status", options: [{ value: "DRAFT", label: "Draft" }, { value: "SENT", label: "Sent" }, { value: "ACCEPTED", label: "Accepted" }, { value: "DECLINED", label: "Declined" }] }, { param: "kind", label: "Type", options: [{ value: "PROPOSAL", label: "Proposals" }, { value: "QUOTE", label: "Quotes" }] }]} />
        {items.length === 0 ? <EmptyState icon={FileSignature} title="No proposals yet" description="Create a proposal or quote to send a priced scope of work." /> : (
          <Table>
            <THead><tr><TH>Number</TH><TH>Prepared for</TH><TH>Date</TH><TH>Scope</TH><TH className="text-right">Total</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((p) => (
                <TR key={p.id}>
                  <TD className="whitespace-nowrap"><Link href={`/admin/proposals/${p.id}`} className="font-medium hover:text-brand">{p.number}</Link><span className="block text-[12px] text-muted-foreground">{p.kind === "QUOTE" ? "Quote" : "Proposal"}</span></TD>
                  <TD>{p.preparedFor}<span className="block text-[12px] text-muted-foreground">{p.addressLine1}, {p.city}{!p.organizationId && " · prospect"}</span></TD>
                  <TD className="whitespace-nowrap">{formatDateKey(p.date)}</TD>
                  <TD className="text-[13px]">{p.scopeTitle}</TD>
                  <TD className="text-right tabular-nums">{p.priceNote ?? formatCents(p.totalCents)}</TD>
                  <TD><Badge tone={PROPOSAL_TONE[p.status]}>{p.status.toLowerCase()}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
