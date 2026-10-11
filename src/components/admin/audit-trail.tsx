import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db";
import { Card, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInstant } from "@/lib/dates";
import { companyTimeZone } from "@/server/services/settings";

function summarize(v: Prisma.JsonValue | null): string {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

/** Read-only audit history (append-only table). */
export async function AuditTrail({ where, title = "Activity", take = 100 }: { where: Prisma.AuditLogWhereInput; title?: string; take?: number }) {
  const [rows, tz] = await Promise.all([prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take, include: { actor: { select: { name: true } } } }), companyTimeZone()]);
  return (
    <Card>
      <CardHeader title={title} description="Append-only audit trail of sensitive changes." />
      <Table>
        <THead><tr><TH>When</TH><TH>Who</TH><TH>Action</TH><TH>Record</TH><TH className="hidden lg:table-cell">Change</TH><TH className="hidden md:table-cell">Reason</TH></tr></THead>
        <TBody>
          {rows.map((r) => (
            <TR key={r.id}>
              <TD className="whitespace-nowrap text-[13px]">{formatInstant(r.createdAt, tz)}</TD>
              <TD className="text-[13px]">{r.actor?.name ?? "System"}</TD>
              <TD className="whitespace-nowrap font-mono text-[12px]">{r.action}</TD>
              <TD className="whitespace-nowrap text-[12px] text-muted-foreground">{r.entityType} · {r.entityId.slice(0, 8)}</TD>
              <TD className="hidden max-w-md lg:table-cell"><code className="block truncate text-[11.5px] text-muted-foreground" title={summarize(r.after)}>{r.before ? `${summarize(r.before)} → ` : ""}{summarize(r.after)}</code></TD>
              <TD className="hidden text-[13px] md:table-cell">{r.reason ?? ""}</TD>
            </TR>
          ))}
          {rows.length === 0 && <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">No activity recorded.</TD></TR>}
        </TBody>
      </Table>
    </Card>
  );
}
