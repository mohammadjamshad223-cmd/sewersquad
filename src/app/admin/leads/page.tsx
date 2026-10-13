import Link from "next/link";
import { Inbox } from "lucide-react";
import type { LeadStatus, Prisma } from "@prisma/client";
import { requireStaffPage } from "@/server/authz/guards";
import { prisma } from "@/server/db";
import { integrations } from "@/server/env";
import { formatDuration, leadStats, minutesToContact } from "@/server/services/leads";
import { companyTimeZone } from "@/server/services/settings";
import { Card } from "@/components/ui/card";
import { Alert, EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { Tabs } from "@/components/ui/tabs";
import { formatInstant } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { AddLeadDialog, LeadContactButtons } from "./lead-ui";

export const metadata = { title: "Leads & inquiries" };

const TABS = [
  { key: "new", label: "Not contacted" },
  { key: "open", label: "In progress" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "All" },
] as const;

const WHERE: Record<string, Prisma.LeadWhereInput> = {
  new: { firstContactedAt: null, status: "NEW" },
  open: { status: { in: ["CONTACTED", "QUOTED"] as LeadStatus[] } },
  won: { status: "WON" },
  lost: { status: "LOST" },
  all: {},
};

const STATUS_STYLE: Record<string, string> = { NEW: "bg-danger-soft text-danger", CONTACTED: "bg-brand-soft text-brand", QUOTED: "bg-warning-soft text-warning", WON: "bg-accent-soft text-accent-strong", LOST: "bg-subtle text-muted-foreground" };

export default async function Leads({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  await requireStaffPage("support.manage");
  const sp = await searchParams;
  const tab = sp.tab && sp.tab in WHERE ? sp.tab : "new";
  const tz = await companyTimeZone();
  const [stats, leads, counts, tickets] = await Promise.all([
    leadStats(),
    prisma.lead.findMany({ where: WHERE[tab], orderBy: tab === "new" ? { receivedAt: "asc" } : { receivedAt: "desc" }, take: 200 }),
    prisma.lead.groupBy({ by: ["status"], _count: true }),
    prisma.supportTicket.count({ where: { status: "OPEN" } }),
  ]);
  const count = (s: LeadStatus[]) => counts.filter((c) => s.includes(c.status)).reduce((n, c) => n + c._count, 0);
  const tabCounts: Record<string, number> = { new: stats.uncontacted, open: count(["CONTACTED", "QUOTED"]), won: count(["WON"]), lost: count(["LOST"]) };

  return (
    <div className="space-y-5">
      <PageHeader title="Leads & inquiries" description="New business from sewersquadservices@gmail.com, sales@sewersquadservices.com, calls and the website." actions={<AddLeadDialog />} />
      {!integrations.leadsInbound() && <Alert tone="info" title="Email inboxes not connected yet">Emails will appear here once forwarding is set up (Settings → Leads inbox has the steps). You can add phone leads now.</Alert>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Not contacted yet" value={stats.uncontacted} tone={stats.uncontacted ? "danger" : "neutral"} href="/admin/leads?tab=new" />
        <Stat label="Typical time to first contact" value={stats.medianMinutes === null ? "—" : formatDuration(stats.medianMinutes)} hint="Median, last 30 days" />
        <Stat label="Contacted within 1 hour" value={stats.withinHourPct === null ? "—" : `${stats.withinHourPct}%`} hint="Last 30 days" tone="success" />
        <Stat label="New leads, last 30 days" value={stats.last30} hint={stats.won ? `${stats.won} won` : undefined} />
      </div>
      <Tabs basePath="/admin/leads" active={tab} tabs={TABS.map((t) => ({ key: t.key, label: t.label, count: tabCounts[t.key] }))} />
      <Card>
        {leads.length === 0 ? (
          <EmptyState icon={Inbox} title={tab === "new" ? "Everyone has been contacted" : "No leads here"} description={tab === "new" ? "New emails and calls will show up here." : undefined} />
        ) : (
          <ul className="divide-y">
            {leads.map((l) => {
              const mins = minutesToContact(l);
              const waiting = !l.firstContactedAt;
              return (
                <li key={l.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link href={`/admin/leads/${l.id}`} className="text-[15px] font-semibold hover:text-brand">{l.name || l.company || l.email || l.phone || l.leadNumber}</Link>
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", STATUS_STYLE[l.status])}>{l.status === "NEW" ? "Not contacted" : l.status[0] + l.status.slice(1).toLowerCase()}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-medium tabular-nums", waiting ? (mins > 60 ? "bg-danger text-white" : "bg-warning-soft text-warning") : mins <= 60 ? "bg-accent-soft text-accent-strong" : "bg-subtle text-muted-foreground")}>{waiting ? `Waiting ${formatDuration(mins)}` : `Contacted in ${formatDuration(mins)}`}</span>
                    </div>
                    <p className="truncate text-[13px] text-muted-foreground">{[l.company && l.name ? l.company : null, l.subject, (l.message ?? "").slice(0, 120)].filter(Boolean).join(" · ")}</p>
                    <p className="text-[12px] text-muted-foreground">{formatInstant(l.receivedAt, tz)} · {l.inbox ?? l.source}</p>
                  </div>
                  <LeadContactButtons compact lead={{ id: l.id, phone: l.phone, email: l.email, name: l.name, subject: l.subject, contacted: !waiting }} />
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <p className="text-[13px] text-muted-foreground">Messages from existing customers in their portal are under <Link href="/admin/support" className="font-medium text-brand hover:underline">Portal messages{tickets ? ` (${tickets} open)` : ""}</Link>.</p>
    </div>
  );
}
