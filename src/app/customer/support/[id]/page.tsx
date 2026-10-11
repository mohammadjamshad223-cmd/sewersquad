import { idParam } from "@/server/params";
import { notFound } from "next/navigation";
import { customerContext } from "@/server/customer-context";
import { getTicketForCustomer } from "@/server/services/support";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status-badge";
import { DocLink } from "@/components/portal/doc-link";
import { formatInstant } from "@/lib/dates";
import { titleCase, cn } from "@/lib/utils";
import { ReplyForm } from "./reply-form";

export const metadata = { title: "Inquiry" };

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const [id, sp] = await Promise.all([idParam(params), searchParams]);
  const { actor } = await customerContext();
  let t;
  try {
    t = await getTicketForCustomer(actor, id);
  } catch (e) {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  const authors = await prisma.user.findMany({ where: { id: { in: t.messages.map((m) => m.authorId) } }, select: { id: true, name: true, kind: true } });
  return (
    <div className="space-y-6">
      <PageHeader title={t.subject} description={`${t.ticketNumber} · ${titleCase(t.category)}${t.location ? ` · ${t.location.name}` : ""}`} breadcrumbs={[{ label: "Support", href: "/customer/support" }, { label: t.ticketNumber }]} actions={<StatusBadge kind="ticket" status={t.status} />} />
      {sp.created && <Alert tone="success" title="Inquiry sent">We&apos;ll reply here and notify you by email.</Alert>}
      <Card>
        <CardBody className="space-y-4">
          {t.messages.map((m) => {
            const a = authors.find((x) => x.id === m.authorId);
            const staff = a?.kind !== "CUSTOMER";
            return (
              <div key={m.id} className={cn("max-w-2xl rounded-lg border px-4 py-3", staff ? "bg-brand-soft/50" : "ml-auto bg-surface")}>
                <p className="text-[12px] text-muted-foreground"><span className="font-medium text-foreground">{staff ? `${a?.name ?? "Sewer Squad"} · Sewer Squad` : a?.name ?? "You"}</span> · {formatInstant(m.createdAt)}</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              </div>
            );
          })}
          {t.documents.length > 0 && <div className="flex flex-wrap gap-4 border-t pt-3">{t.documents.map((d) => <DocLink key={d.id} id={d.id}>{d.title}</DocLink>)}</div>}
        </CardBody>
      </Card>
      {t.status !== "CLOSED" && (
        <Card>
          <CardHeader title="Reply" />
          <CardBody><ReplyForm ticketId={t.id} /></CardBody>
        </Card>
      )}
    </div>
  );
}
