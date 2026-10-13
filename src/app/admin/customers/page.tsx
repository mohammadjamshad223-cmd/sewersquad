import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { requireStaffPage, hasPermission } from "@/server/authz/guards";
import { listOrganizations } from "@/server/services/customers";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { FilterBar } from "@/components/ui/filters";
import { formatCents } from "@/lib/money";
import { titleCase } from "@/lib/utils";

export const metadata = { title: "Customers" };

export default async function Customers({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const actor = await requireStaffPage("customers.read");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { items, total, pageSize } = await listOrganizations({ q: sp.q, status: sp.status, type: sp.type, page });
  return (
    <div>
      <PageHeader title="Customers" description="Customer organizations and their service locations." actions={hasPermission(actor, "customers.write") && <Button asChild><Link href="/admin/new-customer"><Plus /> New Customer</Link></Button>} />
      <Card>
        <FilterBar
          search={{ placeholder: "Name, account #, phone, address…" }}
          selects={[
            { param: "status", label: "Status", options: [{ value: "ACTIVE", label: "Active" }, { value: "INACTIVE", label: "Inactive" }] },
            { param: "type", label: "Type", options: ["RESTAURANT_GROUP", "RESTAURANT", "HOTEL", "HOSPITAL", "SCHOOL", "GROCERY", "INSTITUTIONAL", "OTHER"].map((t) => ({ value: t, label: titleCase(t) })) },
          ]}
        />
        {items.length === 0 ? (
          <EmptyState icon={Building2} title="No customers found" />
        ) : (
          <Table>
            <THead><tr><TH>Customer</TH><TH>Account</TH><TH className="hidden md:table-cell">Type</TH><TH className="text-right">Locations</TH><TH className="hidden lg:table-cell">Rep</TH><TH className="text-right">Open balance</TH><TH>Status</TH></tr></THead>
            <TBody>
              {items.map((o) => (
                <TR key={o.id}>
                  <TD><Link href={`/admin/customers/${o.id}`} className="font-medium hover:text-brand">{o.name}</Link>{o.isDemo && <Badge className="ml-2">Demo</Badge>}<span className="block text-[12px] text-muted-foreground">{o.primaryPhone ?? o.primaryEmail ?? ""}</span></TD>
                  <TD className="whitespace-nowrap font-mono text-[12.5px]">{o.accountNumber}</TD>
                  <TD className="hidden md:table-cell">{titleCase(o.type)}</TD>
                  <TD className="text-right tabular-nums">{o._count.locations}</TD>
                  <TD className="hidden lg:table-cell">{o.accountRep?.name ?? "—"}</TD>
                  <TD className="text-right tabular-nums">{formatCents(o.balanceCents)}</TD>
                  <TD><Badge tone={o.status === "ACTIVE" ? "success" : "neutral"} dot>{titleCase(o.status)}</Badge></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
        <Pagination page={page} pageSize={pageSize} total={total} searchParams={sp} basePath="/admin/customers" />
      </Card>
    </div>
  );
}
