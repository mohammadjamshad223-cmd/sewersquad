"use client";

import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Input, Select, Textarea } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Plus, Pencil } from "lucide-react";
import { addMaintenanceAction, inviteDriverAction, resolveIssueAction, saveVehicleAction, updateDriverAction } from "@/app/admin/_actions/ops";
import { centsToDollarInput } from "@/lib/money";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;
type V = { id: string; unitNumber: string; vin: string | null; licensePlate: string | null; make: string | null; model: string | null; year: number | null; tankCapacityGallons: number; status: string; registrationExpiry: string | null; insuranceExpiry: string | null; permitNumber: string | null; permitExpiry: string | null; costPerHourCents: number | null; notes: string | null };

export function VehicleDialog({ vehicle }: { vehicle?: V }) {
  return (
    <FormDialog trigger={<Button variant={vehicle ? "secondary" : "primary"} size="sm">{vehicle ? <Pencil /> : <Plus />}{vehicle ? "Edit truck" : "Add truck"}</Button>} title={vehicle ? `Edit ${vehicle.unitNumber}` : "Add truck"} size="lg">
      {(close) => (
        <ActionForm action={saveVehicleAction as Act} className="grid gap-4 sm:grid-cols-3" onSuccess={close}>
          {vehicle && <input type="hidden" name="vehicleId" value={vehicle.id} />}
          <Field label="Unit #" name="unitNumber" required><Input defaultValue={vehicle?.unitNumber} /></Field>
          <Field label="Tank capacity (gal)" name="tankCapacityGallons" required><Input inputMode="numeric" defaultValue={vehicle?.tankCapacityGallons} /></Field>
          <Field label="Status" name="status" required><Select defaultValue={vehicle?.status ?? "AVAILABLE"}>{["AVAILABLE", "ASSIGNED", "IN_SERVICE", "MAINTENANCE", "OUT_OF_SERVICE"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>)}</Select></Field>
          <Field label="VIN" name="vin" className="sm:col-span-2"><Input defaultValue={vehicle?.vin ?? ""} /></Field>
          <Field label="Plate" name="licensePlate"><Input defaultValue={vehicle?.licensePlate ?? ""} /></Field>
          <Field label="Make" name="make"><Input defaultValue={vehicle?.make ?? ""} /></Field>
          <Field label="Model" name="model"><Input defaultValue={vehicle?.model ?? ""} /></Field>
          <Field label="Year" name="year"><Input inputMode="numeric" defaultValue={vehicle?.year ?? ""} /></Field>
          <Field label="Registration expires" name="registrationExpiry"><Input type="date" defaultValue={vehicle?.registrationExpiry ?? ""} /></Field>
          <Field label="Insurance expires" name="insuranceExpiry"><Input type="date" defaultValue={vehicle?.insuranceExpiry ?? ""} /></Field>
          <Field label="Operating cost ($/hr)" name="costPerHour" hint="For contribution estimates."><Input inputMode="decimal" defaultValue={centsToDollarInput(vehicle?.costPerHourCents)} /></Field>
          <Field label="Permit #" name="permitNumber"><Input defaultValue={vehicle?.permitNumber ?? ""} /></Field>
          <Field label="Permit expires" name="permitExpiry"><Input type="date" defaultValue={vehicle?.permitExpiry ?? ""} /></Field>
          <Field label="Notes" name="notes" className="sm:col-span-3"><Textarea rows={2} defaultValue={vehicle?.notes ?? ""} /></Field>
          <div className="sm:col-span-3"><SubmitButton>Save truck</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function MaintenanceDialog({ vehicleId, today }: { vehicleId: string; today: string }) {
  return (
    <FormDialog trigger={<Button variant="secondary" size="sm"><Plus /> Log maintenance</Button>} title="Log maintenance">
      {(close) => (
        <ActionForm action={addMaintenanceAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={close}>
          <input type="hidden" name="vehicleId" value={vehicleId} />
          <Field label="Date" name="performedOn" required><Input type="date" defaultValue={today} /></Field>
          <Field label="Category" name="category" required><Input placeholder="Pump, tires, oil…" /></Field>
          <Field label="Description" name="description" required className="sm:col-span-2"><Textarea rows={2} /></Field>
          <Field label="Cost ($)" name="cost"><Input inputMode="decimal" /></Field>
          <Field label="Odometer" name="odometer"><Input inputMode="numeric" /></Field>
          <Field label="Vendor" name="vendor" className="sm:col-span-2"><Input /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function DriverEditDialog({ driver, vehicles }: { driver: { id: string; status: string; licenseNumber: string | null; licenseClass: string | null; licenseExpiry: string | null; territory: string | null; hireDate: string | null; hourlyCostCents: number | null; defaultVehicleId: string | null; phone: string | null }; vehicles: { id: string; unitNumber: string }[] }) {
  return (
    <FormDialog trigger={<Button variant="secondary" size="sm"><Pencil /> Edit</Button>} title="Edit driver" size="lg">
      {(close) => (
        <ActionForm action={updateDriverAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={close}>
          <input type="hidden" name="driverId" value={driver.id} />
          <Field label="Employment status" name="status"><Select defaultValue={driver.status}><option value="ACTIVE">Active</option><option value="ON_LEAVE">On leave</option><option value="INACTIVE">Inactive</option></Select></Field>
          <Field label="Assigned truck" name="defaultVehicleId"><Select defaultValue={driver.defaultVehicleId ?? ""}><option value="">None</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
          <Field label="Phone" name="phone"><Input defaultValue={driver.phone ?? ""} /></Field>
          <Field label="Territory" name="territory"><Input defaultValue={driver.territory ?? ""} /></Field>
          <Field label="License #" name="licenseNumber"><Input defaultValue={driver.licenseNumber ?? ""} /></Field>
          <Field label="Class" name="licenseClass"><Input defaultValue={driver.licenseClass ?? ""} /></Field>
          <Field label="License expires" name="licenseExpiry"><Input type="date" defaultValue={driver.licenseExpiry ?? ""} /></Field>
          <Field label="Hire date" name="hireDate"><Input type="date" defaultValue={driver.hireDate ?? ""} /></Field>
          <Field label="Labor cost ($/hr)" name="hourlyCost" hint="Loaded cost for contribution estimates."><Input inputMode="decimal" defaultValue={centsToDollarInput(driver.hourlyCostCents)} /></Field>
          <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function InviteDriverDialog() {
  return (
    <FormDialog trigger={<Button size="sm"><Plus /> Invite driver</Button>} title="Invite driver" description="They'll get an email link to set a password and use the driver app.">
      {(close) => (
        <ActionForm action={inviteDriverAction as Act} className="space-y-4" onSuccess={close}>
          <Field label="Name" name="name" required><Input /></Field>
          <Field label="Email" name="email" required><Input type="email" /></Field>
          <Field label="Mobile phone" name="phone"><Input type="tel" /></Field>
          <SubmitButton>Send invitation</SubmitButton>
        </ActionForm>
      )}
    </FormDialog>
  );
}

export function IssueResolveForm({ issueId, status }: { issueId: string; status: string }) {
  return (
    <ActionForm action={resolveIssueAction as Act} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="issueId" value={issueId} />
      {status === "OPEN" ? (
        <><input type="hidden" name="status" value="ACKNOWLEDGED" /><SubmitButton size="sm" variant="secondary">Acknowledge</SubmitButton></>
      ) : (
        <><input type="hidden" name="status" value="RESOLVED" /><Input name="resolution" placeholder="Resolution" aria-label="Resolution" className="h-8 w-48 text-[13px]" /><SubmitButton size="sm" variant="secondary">Resolve</SubmitButton></>
      )}
    </ActionForm>
  );
}
