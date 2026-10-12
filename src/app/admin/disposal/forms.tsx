"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Pencil, Plus, RotateCcw, Trash2, XCircle } from "lucide-react";
import { createDisposalBillAction, recordDisposalAdminAction, saveFacilityAction, setDisposalBillStatusAction } from "@/app/admin/_actions/ops";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function AdminDisposalForm({ vehicleId, drivers, facilities, loads, wasteTypes, now }: { vehicleId: string; drivers: { id: string; name: string }[]; facilities: { id: string; name: string }[]; loads: { id: string; jobNumber: string; location: string; gallons: number }[]; wasteTypes: string[]; now: string }) {
  const [sel, setSel] = React.useState(loads.map((l) => l.id));
  const total = loads.filter((l) => sel.includes(l.id)).reduce((s, l) => s + l.gallons, 0);
  return (
    <ActionForm action={recordDisposalAdminAction as Act} className="grid gap-4 sm:grid-cols-3" encType="multipart/form-data" resetOnSuccess>
      <input type="hidden" name="vehicleId" value={vehicleId} />
      <Field label="Driver" name="driverId" required><Select>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Facility" name="facilityId" required><Select><option value="">Select…</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</Select></Field>
      <Field label="Disposed at" name="disposedAt" required><Input type="datetime-local" defaultValue={now} /></Field>
      <fieldset className="space-y-1 sm:col-span-3">
        <legend className="text-[13px] font-medium">Loads ({total.toLocaleString()} gal selected)</legend>
        {loads.length === 0 && <p className="text-[13px] text-muted-foreground">No unallocated loads for this truck in the last 14 days.</p>}
        {loads.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><Checkbox name="jobIds[]" value={l.id} checked={sel.includes(l.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, l.id] : s.filter((x) => x !== l.id)))} /> {l.jobNumber} · {l.location} · {l.gallons.toLocaleString()} gal</label>)}
      </fieldset>
      <Field label="Waste type" name="wasteType" required><Select>{wasteTypes.map((w) => <option key={w}>{w}</option>)}</Select></Field>
      <Field label="Gallons disposed" name="gallons" required><Input inputMode="numeric" defaultValue={total || ""} key={total} /></Field>
      <Field label="Rate ($/gal)" name="ratePerGallon" hint="Blank = facility default"><Input inputMode="decimal" /></Field>
      <Field label="Opening load" name="openingLoadGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Closing load" name="closingLoadGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Ticket #" name="ticketNumber"><Input /></Field>
      <Field label="Adjustment (gal)" name="adjustmentGallons"><Input inputMode="numeric" defaultValue="0" /></Field>
      <Field label="Adjustment reason" name="adjustmentReason" className="sm:col-span-2"><Input /></Field>
      <Field label="Ticket / receipt" name="ticket" className="sm:col-span-2"><Input type="file" accept="image/*,application/pdf" /></Field>
      <label className="flex items-center gap-2 self-end pb-2 text-sm"><Checkbox name="facilityAcknowledged" /> Facility acknowledgment on ticket</label>
      <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea rows={2} /></Field>
      <div className="sm:col-span-3"><SubmitButton>Record disposal event</SubmitButton></div>
    </ActionForm>
  );
}

export function FacilityDialog({ facility, wasteTypes }: { facility?: { id: string; name: string; addressLine1: string; city: string; state: string; postalCode: string; phone: string | null; permitNumber: string | null; acceptedWasteTypes: string[]; rate: string | null; status: string; notes: string | null; vendorAccountNumber: string | null; remitTo: string | null; billingPhone: string | null }; wasteTypes: string[] }) {
  return (
    <FormDialog trigger={<Button size="sm" variant={facility ? "ghost" : "primary"}>{facility ? <Pencil /> : <Plus />}{facility ? "Edit" : "Add facility"}</Button>} title={facility ? "Edit facility" : "Add disposal facility"} size="lg">
      {(close) => (
        <ActionForm action={saveFacilityAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={close}>
          {facility && <input type="hidden" name="facilityId" value={facility.id} />}
          <Field label="Name" name="name" required className="sm:col-span-2"><Input defaultValue={facility?.name} /></Field>
          <Field label="Address" name="addressLine1" required className="sm:col-span-2"><Input defaultValue={facility?.addressLine1} /></Field>
          <Field label="City" name="city" required><Input defaultValue={facility?.city} /></Field>
          <div className="grid grid-cols-2 gap-3"><Field label="State" name="state" required><Input defaultValue={facility?.state ?? "TX"} maxLength={2} /></Field><Field label="ZIP" name="postalCode" required><Input defaultValue={facility?.postalCode} /></Field></div>
          <Field label="Phone" name="phone"><Input defaultValue={facility?.phone ?? ""} /></Field>
          <Field label="Permit #" name="permitNumber"><Input defaultValue={facility?.permitNumber ?? ""} /></Field>
          <Field label="Default rate ($/gal)" name="ratePerGallon"><Input inputMode="decimal" defaultValue={facility?.rate ?? ""} placeholder="0.065" /></Field>
          <Field label="Status" name="status"><Select defaultValue={facility?.status ?? "ACTIVE"}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>
          <fieldset className="sm:col-span-2"><legend className="text-[13px] font-medium">Accepted waste types</legend><div className="mt-1 flex flex-wrap gap-3">{wasteTypes.map((w) => <label key={w} className="flex items-center gap-2 text-sm"><Checkbox name="acceptedWasteTypes[]" value={w} defaultChecked={facility?.acceptedWasteTypes.includes(w)} /> {w}</label>)}</div></fieldset>
          <Field label="Our account # with this vendor" name="vendorAccountNumber"><Input defaultValue={facility?.vendorAccountNumber ?? ""} /></Field>
          <Field label="Billing phone" name="billingPhone"><Input defaultValue={facility?.billingPhone ?? ""} /></Field>
          <Field label="Remit payments to" name="remitTo" className="sm:col-span-2"><Textarea rows={2} defaultValue={facility?.remitTo ?? ""} /></Field>
          <Field label="Notes" name="notes" className="sm:col-span-2"><Textarea rows={2} defaultValue={facility?.notes ?? ""} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save facility</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

type Line = { description: string; wasteType: string; gallons: string; rate: string; amount: string; manifests: string; manifestDate: string };
const blankLine = (rate = ""): Line => ({ description: "Disposal", wasteType: "", gallons: "", rate, amount: "", manifests: "", manifestDate: "" });

/** Line total preview: the typed amount, else gallons × rate (the server recomputes and is authoritative). */
function lineCents(l: Line): number | null {
  if (l.amount) {
    const n = Number(l.amount.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  }
  const g = Number(l.gallons.replace(/,/g, ""));
  const r = Number(l.rate.replace(/[$,]/g, ""));
  return l.gallons && l.rate && Number.isFinite(g) && Number.isFinite(r) ? Math.round(g * r * 100) : null;
}
const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export function BillDialog({ facilities, wasteTypes, today }: { facilities: { id: string; name: string; rate: string | null }[]; wasteTypes: string[]; today: string }) {
  const [facilityId, setFacilityId] = React.useState("");
  const defaultRate = facilities.find((f) => f.id === facilityId)?.rate ?? "";
  const [lines, setLines] = React.useState<Line[]>([blankLine()]);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (lineCents(l) ?? 0), 0);
  return (
    <FormDialog trigger={<Button size="sm"><Plus /> Add vendor bill</Button>} title="Add disposal vendor bill" description="Enter it the way it appears on the vendor's invoice. Attach the PDF so it is on file." size="xl">
      {(close) => (
        <ActionForm action={createDisposalBillAction as Act} className="grid gap-4 sm:grid-cols-3" encType="multipart/form-data" onSuccess={() => { setLines([blankLine()]); close(); }}>
          <input type="hidden" name="lines" value={JSON.stringify(lines)} />
          <Field label="Vendor" name="facilityId" required>
            <Select value={facilityId} onChange={(e) => { setFacilityId(e.target.value); const r = facilities.find((f) => f.id === e.target.value)?.rate ?? ""; setLines((ls) => ls.map((l) => (l.rate ? l : { ...l, rate: r }))); }}>
              <option value="">Select…</option>
              {facilities.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Field>
          <Field label="Vendor invoice #" name="vendorInvoiceNumber" required><Input /></Field>
          <Field label="Invoice date" name="invoiceDate" required><Input type="date" defaultValue={today} /></Field>
          <Field label="Due date" name="dueDate"><Input type="date" /></Field>
          <Field label="Service date" name="serviceDate"><Input type="date" /></Field>
          <Field label="Ticket / service call #" name="referenceNumber"><Input /></Field>
          <fieldset className="space-y-3 sm:col-span-3">
            <legend className="text-[13px] font-medium">Lines</legend>
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-md border p-3 sm:grid-cols-6">
                <label className="text-[12px] sm:col-span-2">Description<Input value={l.description} onChange={(e) => set(i, { description: e.target.value })} aria-label={`Line ${i + 1} description`} /></label>
                <label className="text-[12px]">Waste type<Select value={l.wasteType} onChange={(e) => set(i, { wasteType: e.target.value })} aria-label={`Line ${i + 1} waste type`}><option value="">—</option>{wasteTypes.map((w) => <option key={w}>{w}</option>)}</Select></label>
                <label className="text-[12px]">Gallons<Input inputMode="numeric" value={l.gallons} onChange={(e) => set(i, { gallons: e.target.value })} aria-label={`Line ${i + 1} gallons`} /></label>
                <label className="text-[12px]">Rate ($/gal)<Input inputMode="decimal" value={l.rate} placeholder={defaultRate} onChange={(e) => set(i, { rate: e.target.value })} aria-label={`Line ${i + 1} rate`} /></label>
                <label className="text-[12px]">Amount ($)<Input inputMode="decimal" value={l.amount} placeholder={lineCents({ ...l, amount: "" }) !== null ? (lineCents({ ...l, amount: "" })! / 100).toFixed(2) : "auto"} onChange={(e) => set(i, { amount: e.target.value })} aria-label={`Line ${i + 1} amount`} /></label>
                <label className="text-[12px] sm:col-span-3">Our manifest #s<Input value={l.manifests} placeholder="194401, 194402" onChange={(e) => set(i, { manifests: e.target.value })} aria-label={`Line ${i + 1} manifests`} /></label>
                <label className="text-[12px] sm:col-span-2">Manifest date<Input type="date" value={l.manifestDate} onChange={(e) => set(i, { manifestDate: e.target.value })} aria-label={`Line ${i + 1} manifest date`} /></label>
                <div className="flex items-end justify-end">{lines.length > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 /> Remove</Button>}</div>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button type="button" variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, blankLine(defaultRate)])}><Plus /> Add line</Button>
              <p className="text-sm">Total <span className="font-semibold tabular-nums">{usd(total)}</span></p>
            </div>
          </fieldset>
          <Field label="Vendor invoice (PDF or photo)" name="file" className="sm:col-span-2"><Input type="file" accept="image/*,application/pdf" /></Field>
          <Field label="Notes" name="notes"><Input /></Field>
          <div className="sm:col-span-3"><SubmitButton>Save bill</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function BillStatusActions({ billId, status, label, today }: { billId: string; status: "OPEN" | "PAID" | "VOID"; label: string; today: string }) {
  if (status === "VOID") return null;
  return (
    <div className="flex justify-end gap-1">
      {status === "OPEN" ? (
        <FormDialog trigger={<Button size="sm" variant="ghost"><CheckCircle2 /> Mark paid</Button>} title={`Mark ${label} paid`}>
          {(close) => (
            <ActionForm action={setDisposalBillStatusAction as Act} className="space-y-4" onSuccess={close}>
              <input type="hidden" name="billId" value={billId} />
              <input type="hidden" name="status" value="PAID" />
              <Field label="Paid on" name="paidAt" required><Input type="date" defaultValue={today} /></Field>
              <Field label="Check # or confirmation" name="paymentReference"><Input /></Field>
              <SubmitButton>Mark paid</SubmitButton>
            </ActionForm>
          )}
        </FormDialog>
      ) : (
        <ActionForm action={setDisposalBillStatusAction as Act}>
          <input type="hidden" name="billId" value={billId} />
          <input type="hidden" name="status" value="OPEN" />
          <SubmitButton size="sm" variant="ghost"><RotateCcw /> Re-open</SubmitButton>
        </ActionForm>
      )}
      <FormDialog trigger={<Button size="sm" variant="ghost" aria-label={`Void ${label}`}><XCircle /></Button>} title={`Void ${label}`} description="Use this for a duplicate or a bill entered by mistake. It stays on record but is left out of every total.">
        {(close) => (
          <ActionForm action={setDisposalBillStatusAction as Act} className="space-y-4" onSuccess={close}>
            <input type="hidden" name="billId" value={billId} />
            <input type="hidden" name="status" value="VOID" />
            <Field label="Reason" name="reason" required><Input /></Field>
            <SubmitButton variant="danger">Void bill</SubmitButton>
          </ActionForm>
        )}
      </FormDialog>
    </div>
  );
}
