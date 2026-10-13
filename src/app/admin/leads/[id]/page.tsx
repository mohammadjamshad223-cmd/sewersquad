import Link from "next/link";
import { notFound } from "next/navigation";
import { UserPlus } from "lucide-react";
import { requireStaffPage } from "@/server/authz/guards";
import { idParam } from "@/server/params";
import { prisma } from "@/server/db";
import { formatDuration, minutesToContact } from "@/server/services/leads";
import { companyTimeZone } from "@/server/services/settings";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { DescriptionList, PageHeader } from "@/components/ui/misc";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Textarea } from "@/components/ui/input";
import { formatInstant } from "@/lib/dates";
import { addLeadNoteAction } from "@/app/admin/_actions/leads";
import { LeadContactButtons, LeadStatusSelect } from "../lead-ui";

export const metadata = { title: "Lead" };

const KIND: Record<string, string> = { email_in: "Email received", email_out: "Email sent", call: "Call", text: "Text", note: "Note", status: "Status" };

export default async function LeadDetail({ params }: { params: Promise<{ id: string }> }) {
  const id = await idParam(params);
  await requireStaffPage("support.manage");
  const lead = await prisma.lead.findUnique({ where: { id }, include: { activities: { orderBy: { occurredAt: "desc" } } } });
  if (!lead) notFound();
  const tz = await companyTimeZone();
  const users = await prisma.user.findMany({ where: { id: { in: [lead.firstContactedById, ...lead.activities.map((a) => a.actorId)].filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const who = (uid: string | null) => users.find((u) => u.id === uid)?.name;
  const mins = minutesToContact(lead);
  const newCustomer = `/admin/new-customer?${new URLSearchParams({ ...(lead.company || lead.name ? { name: lead.company ?? lead.name! } : {}), ...(lead.name ? { contact: lead.name } : {}), ...(lead.email ? { email: lead.email } : {}), ...(lead.phone ? { phone: lead.phone } : {}), lead: lead.id })}`;

  return (
    <div className="space-y-5">
      <PageHeader title={lead.name || lead.company || lead.email || lead.leadNumber} description={`${lead.leadNumber} · received ${formatInstant(lead.receivedAt, tz)}${lead.inbox ? ` · ${lead.inbox}` : ""}`} breadcrumbs={[{ label: "Leads", href: "/admin/leads" }, { label: lead.leadNumber }]} actions={<><LeadStatusSelect id={lead.id} status={lead.status} />{lead.organizationId ? <Button asChild size="sm" variant="secondary"><Link href={`/admin/customers/${lead.organizationId}`}>Open customer</Link></Button> : <Button asChild size="sm"><Link href={newCustomer}><UserPlus /> Make customer</Link></Button>}</>} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title={lead.subject ?? "Inquiry"} />
            <CardBody className="space-y-4">
              <LeadContactButtons lead={{ id: lead.id, phone: lead.phone, email: lead.email, name: lead.name, subject: lead.subject, contacted: !!lead.firstContactedAt }} />
              {lead.message && <p className="whitespace-pre-wrap text-[14px] leading-relaxed">{lead.message}</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="History" />
            <ul className="divide-y">
              {lead.activities.map((a) => (
                <li key={a.id} className="px-5 py-3 text-[14px]">
                  <p className="text-[12px] font-medium text-muted-foreground">{KIND[a.kind] ?? a.kind} · {formatInstant(a.occurredAt, tz)}{who(a.actorId) ? ` · ${who(a.actorId)}` : ""}</p>
                  {a.body && <p className="mt-1 line-clamp-6 whitespace-pre-wrap">{a.body}</p>}
                </li>
              ))}
            </ul>
          </Card>
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Response time" />
            <CardBody>
              <p className="text-2xl font-semibold tabular-nums">{lead.firstContactedAt ? formatDuration(mins) : `Waiting ${formatDuration(mins)}`}</p>
              <p className="text-[13px] text-muted-foreground">{lead.firstContactedAt ? `First contact ${formatInstant(lead.firstContactedAt, tz)} by ${lead.firstContactMethod ?? "—"}${who(lead.firstContactedById) ? ` (${who(lead.firstContactedById)})` : ""}` : "Not contacted yet."}</p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody><DescriptionList columns={1} items={[{ label: "Business", value: lead.company ?? "—" }, { label: "Phone", value: lead.phone ?? "—" }, { label: "Email", value: lead.email ?? "—" }, { label: "Source", value: lead.inbox ?? lead.source }, { label: "Follow up", value: lead.nextFollowUpAt ? formatInstant(lead.nextFollowUpAt, tz) : "—" }]} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Add a note" />
            <CardBody>
              <ActionForm action={addLeadNoteAction as (s: ActionState, fd: FormData) => Promise<ActionState>} resetOnSuccess className="space-y-3">
                <input type="hidden" name="leadId" value={lead.id} />
                <Field label="Note" name="body"><Textarea rows={3} placeholder="Quoted $0.89/gal, call back Friday…" /></Field>
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
