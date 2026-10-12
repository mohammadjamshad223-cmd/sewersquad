"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/input";
import { Alert, Stat } from "@/components/ui/misc";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatCents } from "@/lib/money";
import { importStepAction } from "@/app/admin/_actions/paperwork";

type Preview = {
  customers: number;
  existingCustomers: number;
  locations: number;
  invoices: { number: string; date: string; client: string; service: string; totalCents: number; draft: boolean; reconstructed: boolean; imported: boolean }[];
  proposals: { number: string; preparedFor: string; totalCents: number | null; priceNote: string | null; imported: boolean }[];
  reports: { number: string; preparedFor: string; subject: string; imported: boolean }[];
  company: { name: string; addressLine1: string; city: string; phone: string; email: string; tceqNumber: string };
};
type Step = { phase: string; cursor: number };

export function ImportRunner({ preview }: { preview: Preview }) {
  const router = useRouter();
  const issued = preview.invoices.filter((i) => !i.draft);
  const [paid, setPaid] = React.useState<Set<string>>(() => new Set(issued.map((i) => i.number)));
  const [applyCompany, setApplyCompany] = React.useState(true);
  const [createPlans, setCreatePlans] = React.useState(true);
  const [confirmed, setConfirmed] = React.useState(false);
  const [running, setRunning] = React.useState(false);
  const [log, setLog] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [done, setDone] = React.useState(false);
  const allImported = preview.invoices.every((i) => i.imported) && preview.proposals.every((p) => p.imported) && preview.reports.every((r) => r.imported);
  const unpaid = issued.filter((i) => !paid.has(i.number));
  const toggle = (n: string) => setPaid((s) => { const x = new Set(s); if (x.has(n)) x.delete(n); else x.add(n); return x; });

  async function run() {
    setRunning(true);
    setError(null);
    setLog([]);
    let step: Step = { phase: "company", cursor: 0 };
    const options = { unpaid: unpaid.map((i) => i.number), applyCompany, createPlans };
    for (let guard = 0; step.phase !== "done" && guard < 40; guard++) {
      const res = await importStepAction(options, step);
      if (!res.ok) {
        setError(`${res.error} Nothing is lost — run the import again to continue where it stopped.`);
        setRunning(false);
        return;
      }
      const r = res.data as { next: Step; log: string[] };
      setLog((l) => [...l, ...r.log.filter((x) => !x.endsWith("already in the portal."))]);
      step = r.next;
    }
    setRunning(false);
    setDone(true);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat label="Customers" value={preview.customers} hint={`${preview.locations} locations · ${preview.existingCustomers} already in the portal`} />
        <Stat label="Invoices" value={preview.invoices.length} hint={formatCents(issued.reduce((s, i) => s + i.totalCents, 0))} />
        <Stat label="Proposals & quotes" value={preview.proposals.length} />
        <Stat label="Service reports" value={preview.reports.length} />
      </div>
      {allImported && !done && <Alert tone="success" title="Already imported">Everything in your records is in the portal. Running it again changes nothing.</Alert>}
      <Card>
        <CardHeader title="1. Which invoices have been paid?" description="Ticked = paid (recorded as “paid before the portal”). Untick every invoice the customer still owes." action={<div className="flex gap-2"><Button size="sm" variant="ghost" onClick={() => setPaid(new Set(issued.map((i) => i.number)))}>Tick all</Button><Button size="sm" variant="ghost" onClick={() => setPaid(new Set())}>Untick all</Button></div>} />
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <THead><tr><TH>Paid</TH><TH>Invoice</TH><TH>Date</TH><TH>Customer</TH><TH>Service</TH><TH className="text-right">Total</TH></tr></THead>
            <TBody>
              {preview.invoices.map((i) => (
                <TR key={i.number}>
                  <TD>{i.draft ? <span className="text-[12px] text-muted-foreground">draft</span> : <Checkbox aria-label={`Invoice ${i.number} paid`} checked={paid.has(i.number)} disabled={i.imported || running} onChange={() => toggle(i.number)} />}</TD>
                  <TD className="font-medium">{i.number}{i.imported && <span className="ml-1 text-[11px] text-success">imported</span>}</TD>
                  <TD className="whitespace-nowrap text-[13px]">{i.date}</TD>
                  <TD className="text-[13px]">{i.client}</TD>
                  <TD className="text-[13px]">{i.service}{i.draft && <span className="block text-[12px] text-warning">Total was TBD — imported as a draft to price</span>}</TD>
                  <TD className="text-right tabular-nums">{formatCents(i.totalCents)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
        <CardBody className="text-sm">{unpaid.length} unpaid ({formatCents(unpaid.reduce((s, i) => s + i.totalCents, 0))}): {unpaid.map((i) => i.number).join(", ") || "none"}</CardBody>
      </Card>
      <Card>
        <CardHeader title="2. Options" />
        <CardBody className="space-y-3 text-sm">
          <label className="flex items-start gap-2"><Checkbox checked={applyCompany} onChange={(e) => setApplyCompany(e.target.checked)} /> <span>Fill in company details that are still blank: {preview.company.name}, {preview.company.addressLine1}, {preview.company.city} · {preview.company.phone} · {preview.company.email} · TCEQ #{preview.company.tceqNumber}. Payment terms become “due upon receipt”. The City of Houston # stays blank until you enter it.</span></label>
          <label className="flex items-start gap-2"><Checkbox checked={createPlans} onChange={(e) => setCreatePlans(e.target.checked)} /> <span>Create a recurring 90-day service schedule for each trap location, starting on the next service date from its last invoice (at its last price). Locations already past their date are scheduled for today.</span></label>
          <label className="flex items-start gap-2 font-medium"><Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> <span>I&apos;ve unticked every unpaid invoice above.</span></label>
        </CardBody>
      </Card>
      {error && <Alert tone="danger" title="Import stopped">{error}</Alert>}
      <div className="flex items-center gap-3">
        <Button onClick={run} disabled={running || !confirmed}>{running ? <Loader2 className="animate-spin" /> : done ? <CheckCircle2 /> : <Upload />} {running ? "Importing…" : done ? "Run again" : "Import my records"}</Button>
        {running && <span className="text-sm text-muted-foreground">This takes about a minute. Keep this page open.</span>}
      </div>
      {log.length > 0 && (
        <Card>
          <CardHeader title={done ? "Import finished" : "Progress"} />
          <CardBody><ul className="max-h-80 space-y-1 overflow-y-auto text-[13px]">{log.map((l, i) => <li key={i}>{l}</li>)}</ul></CardBody>
        </Card>
      )}
    </div>
  );
}
