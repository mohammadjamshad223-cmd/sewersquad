"use client";

import * as React from "react";
import { ActionForm, Field, SubmitButton, type ActionState } from "@/components/ui/form";
import { Checkbox, Input, Select, Textarea } from "@/components/ui/input";
import { ASSET_TYPE_LABEL, SERVICE_TYPE_LABEL } from "@/lib/status";
import { FREQUENCY_PRESETS } from "@/domain/recurrence";
import { centsToDollarInput } from "@/lib/money";
import {
  createLocationAction,
  createOrganizationAction,
  inviteCustomerUserAction,
  saveAssetAction,
  saveBillingProfileAction,
  saveContactAction,
  savePlanAction,
  updateLocationAction,
  updateOrganizationAction,
} from "@/app/admin/_actions/customers";

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

export function OrganizationForm({ org, reps, onDone }: { org?: { id: string; name: string; type: string; billingMode: string; primaryEmail: string | null; primaryPhone: string | null; website: string | null; notes: string | null; accountRepId: string | null }; reps: { id: string; name: string }[]; onDone?: () => void }) {
  return (
    <ActionForm action={(org ? updateOrganizationAction : createOrganizationAction) as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone} successMessage={org ? undefined : false}>
      {org && <input type="hidden" name="id" value={org.id} />}
      <Field label="Customer name" name="name" required className="sm:col-span-2"><Input defaultValue={org?.name} /></Field>
      <Field label="Type" name="type" required>
        <Select defaultValue={org?.type ?? "RESTAURANT"}>
          {[["RESTAURANT_GROUP", "Restaurant group"], ["RESTAURANT", "Restaurant"], ["HOTEL", "Hotel"], ["HOSPITAL", "Hospital"], ["SCHOOL", "School"], ["GROCERY", "Grocery"], ["INSTITUTIONAL", "Institutional"], ["OTHER", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Billing" name="billingMode" required hint="Consolidated = one account; per location = each site billed separately.">
        <Select defaultValue={org?.billingMode ?? "CONSOLIDATED"}><option value="CONSOLIDATED">Consolidated</option><option value="PER_LOCATION">Per location</option></Select>
      </Field>
      <Field label="Primary email" name="primaryEmail"><Input type="email" defaultValue={org?.primaryEmail ?? ""} /></Field>
      <Field label="Primary phone" name="primaryPhone"><Input type="tel" defaultValue={org?.primaryPhone ?? ""} /></Field>
      <Field label="Website" name="website"><Input defaultValue={org?.website ?? ""} /></Field>
      <Field label="Account representative" name="accountRepId"><Select defaultValue={org?.accountRepId ?? ""}><option value="">Unassigned</option>{reps.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
      <Field label="Internal notes" name="notes" className="sm:col-span-2" hint="Not visible to the customer."><Textarea defaultValue={org?.notes ?? ""} rows={3} /></Field>
      <div className="sm:col-span-2"><SubmitButton>{org ? "Save changes" : "Create customer"}</SubmitButton></div>
    </ActionForm>
  );
}

type Loc = { id: string; name: string; addressLine1: string; addressLine2: string | null; city: string; state: string; postalCode: string; county: string | null; siteContactName: string | null; siteContactPhone: string | null; siteContactEmail: string | null; accessInstructions: string | null; specialRequirements: string | null; territory: string | null; defaultWindowStart: string | null; defaultWindowEnd: string | null; latitude: number | null; longitude: number | null; billingProfileId: string | null; manifestFee?: string };

export function LocationForm({ organizationId, loc, billingProfiles, onDone }: { organizationId?: string; loc?: Loc; billingProfiles: { id: string; name: string }[]; onDone?: () => void }) {
  return (
    <ActionForm action={(loc ? updateLocationAction : createLocationAction) as Act} className="grid gap-4 sm:grid-cols-6" onSuccess={onDone} successMessage={loc ? undefined : false}>
      {loc ? <input type="hidden" name="id" value={loc.id} /> : <input type="hidden" name="organizationId" value={organizationId} />}
      <Field label="Location name" name="name" required className="sm:col-span-6"><Input defaultValue={loc?.name} placeholder="e.g. ABC Restaurant — Katy" /></Field>
      <Field label="Address" name="addressLine1" required className="sm:col-span-4"><Input defaultValue={loc?.addressLine1} autoComplete="address-line1" /></Field>
      <Field label="Suite / unit" name="addressLine2" className="sm:col-span-2"><Input defaultValue={loc?.addressLine2 ?? ""} /></Field>
      <Field label="City" name="city" required className="sm:col-span-2"><Input defaultValue={loc?.city} /></Field>
      <Field label="State" name="state" required><Input defaultValue={loc?.state ?? "TX"} maxLength={2} /></Field>
      <Field label="ZIP" name="postalCode" required><Input defaultValue={loc?.postalCode} inputMode="numeric" /></Field>
      <Field label="County" name="county" className="sm:col-span-2"><Input defaultValue={loc?.county ?? ""} placeholder="Harris" /></Field>
      <Field label="Latitude" name="latitude" className="sm:col-span-3" hint="Optional — used for map views and route grouping."><Input defaultValue={loc?.latitude ?? ""} inputMode="decimal" /></Field>
      <Field label="Longitude" name="longitude" className="sm:col-span-3"><Input defaultValue={loc?.longitude ?? ""} inputMode="decimal" /></Field>
      <Field label="Site contact" name="siteContactName" className="sm:col-span-2"><Input defaultValue={loc?.siteContactName ?? ""} /></Field>
      <Field label="Site phone" name="siteContactPhone" className="sm:col-span-2"><Input type="tel" defaultValue={loc?.siteContactPhone ?? ""} /></Field>
      <Field label="Site email" name="siteContactEmail" className="sm:col-span-2"><Input type="email" defaultValue={loc?.siteContactEmail ?? ""} /></Field>
      <Field label="Default window start" name="defaultWindowStart" className="sm:col-span-2"><Input type="time" defaultValue={loc?.defaultWindowStart ?? ""} /></Field>
      <Field label="Default window end" name="defaultWindowEnd" className="sm:col-span-2"><Input type="time" defaultValue={loc?.defaultWindowEnd ?? ""} /></Field>
      <Field label="Territory / route" name="territory" className="sm:col-span-2"><Input defaultValue={loc?.territory ?? ""} placeholder="Houston Central" /></Field>
      <Field label="Manifest fee on invoices" name="manifestFee" hint="A percentage of the trap service (Settings → Billing)."><Select defaultValue={loc?.manifestFee ?? "NONE"}><option value="NONE">None</option><option value="CITY_OF_HOUSTON">City of Houston manifest fee</option><option value="STANDARD">Manifest fee</option><option value="WAIVED">Waived</option></Select></Field>
      <Field label="Access instructions" name="accessInstructions" className="sm:col-span-3"><Textarea rows={3} defaultValue={loc?.accessInstructions ?? ""} /></Field>
      <Field label="Special requirements" name="specialRequirements" className="sm:col-span-3"><Textarea rows={3} defaultValue={loc?.specialRequirements ?? ""} /></Field>
      <Field label="Billing profile" name="billingProfileId" className="sm:col-span-3"><Select defaultValue={loc?.billingProfileId ?? ""}><option value="">Customer default</option>{billingProfiles.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
      <div className="sm:col-span-6"><SubmitButton>{loc ? "Save location" : "Create location"}</SubmitButton></div>
    </ActionForm>
  );
}

type Asset = { id: string; type: string; customTypeLabel: string | null; name: string | null; capacityGallons: number; placement: string; installLocation: string | null; accessInstructions: string | null; requiredEquipment: string | null; frequencyDays: number | null; notes: string | null; status: string };

export function AssetForm({ locationId, asset, onDone }: { locationId: string; asset?: Asset; onDone?: () => void }) {
  const [type, setType] = React.useState(asset?.type ?? "GREASE_INTERCEPTOR");
  return (
    <ActionForm action={saveAssetAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone} resetOnSuccess={!asset}>
      <input type="hidden" name="locationId" value={locationId} />
      {asset && <input type="hidden" name="assetId" value={asset.id} />}
      <Field label="Type" name="type" required><Select value={type} onChange={(e) => setType(e.target.value)}>{Object.entries(ASSET_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      {type === "OTHER" ? <Field label="Custom type" name="customTypeLabel" required><Input defaultValue={asset?.customTypeLabel ?? ""} /></Field> : <Field label="Name (optional)" name="name"><Input defaultValue={asset?.name ?? ""} placeholder="e.g. Main interceptor" /></Field>}
      <Field label="Capacity (gallons)" name="capacityGallons" required><Input inputMode="numeric" defaultValue={asset?.capacityGallons ?? ""} /></Field>
      <Field label="Placement" name="placement" required><Select defaultValue={asset?.placement ?? "OUTDOOR"}><option value="OUTDOOR">Outdoor</option><option value="INDOOR">Indoor</option></Select></Field>
      <Field label="Installed at" name="installLocation"><Input defaultValue={asset?.installLocation ?? ""} placeholder="Rear alley under steel plate" /></Field>
      <Field label="Typical frequency (days)" name="frequencyDays" hint="Reference only; schedules are set on plans."><Input inputMode="numeric" defaultValue={asset?.frequencyDays ?? ""} /></Field>
      <Field label="Required tools / equipment" name="requiredEquipment" className="sm:col-span-2"><Input defaultValue={asset?.requiredEquipment ?? ""} /></Field>
      <Field label="Access instructions" name="accessInstructions" className="sm:col-span-2"><Textarea rows={2} defaultValue={asset?.accessInstructions ?? ""} /></Field>
      <Field label="Notes" name="notes" className="sm:col-span-2"><Textarea rows={2} defaultValue={asset?.notes ?? ""} /></Field>
      {asset && <Field label="Status" name="status"><Select defaultValue={asset.status}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select></Field>}
      <div className="sm:col-span-2"><SubmitButton>{asset ? "Save equipment" : "Add equipment"}</SubmitButton></div>
    </ActionForm>
  );
}

export function ContactForm({ organizationId, locations, contact, onDone }: { organizationId: string; locations: { id: string; name: string }[]; contact?: { id: string; name: string; title: string | null; email: string | null; phone: string | null; locationId: string | null; isPrimary: boolean; receivesInvoices: boolean; receivesReminders: boolean }; onDone?: () => void }) {
  return (
    <ActionForm action={saveContactAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone} resetOnSuccess={!contact}>
      <input type="hidden" name="organizationId" value={organizationId} />
      {contact && <input type="hidden" name="contactId" value={contact.id} />}
      <Field label="Name" name="name" required><Input defaultValue={contact?.name} /></Field>
      <Field label="Title" name="title"><Input defaultValue={contact?.title ?? ""} /></Field>
      <Field label="Email" name="email"><Input type="email" defaultValue={contact?.email ?? ""} /></Field>
      <Field label="Phone" name="phone"><Input type="tel" defaultValue={contact?.phone ?? ""} /></Field>
      <Field label="Location" name="locationId" className="sm:col-span-2"><Select defaultValue={contact?.locationId ?? ""}><option value="">All locations (organization)</option>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
      <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><Checkbox name="isPrimary" defaultChecked={contact?.isPrimary} /> Primary contact</label>
        <label className="flex items-center gap-2"><Checkbox name="receivesInvoices" defaultChecked={contact?.receivesInvoices} /> Receives invoices</label>
        <label className="flex items-center gap-2"><Checkbox name="receivesReminders" defaultChecked={contact?.receivesReminders ?? true} /> Receives reminders</label>
      </div>
      <div className="sm:col-span-2"><SubmitButton>Save contact</SubmitButton></div>
    </ActionForm>
  );
}

export function BillingProfileForm({ organizationId, profile, onDone }: { organizationId: string; profile?: { id: string; name: string; billingEmail: string | null; billingPhone: string | null; addressLine1: string | null; city: string | null; state: string | null; postalCode: string | null; paymentTermsDays: number; taxExempt: boolean; taxRateBps: number | null; allowPartialPayments: boolean | null; poNumber: string | null; isDefault: boolean }; onDone?: () => void }) {
  return (
    <ActionForm action={saveBillingProfileAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone}>
      <input type="hidden" name="organizationId" value={organizationId} />
      {profile && <input type="hidden" name="profileId" value={profile.id} />}
      <Field label="Profile name" name="name" required className="sm:col-span-2"><Input defaultValue={profile?.name} /></Field>
      <Field label="Billing email" name="billingEmail"><Input type="email" defaultValue={profile?.billingEmail ?? ""} /></Field>
      <Field label="Billing phone" name="billingPhone"><Input defaultValue={profile?.billingPhone ?? ""} /></Field>
      <Field label="Address" name="addressLine1" className="sm:col-span-2"><Input defaultValue={profile?.addressLine1 ?? ""} /></Field>
      <Field label="City" name="city"><Input defaultValue={profile?.city ?? ""} /></Field>
      <div className="grid grid-cols-2 gap-3"><Field label="State" name="state"><Input defaultValue={profile?.state ?? "TX"} maxLength={2} /></Field><Field label="ZIP" name="postalCode"><Input defaultValue={profile?.postalCode ?? ""} /></Field></div>
      <Field label="Payment terms (days)" name="paymentTermsDays" required><Input inputMode="numeric" defaultValue={profile?.paymentTermsDays ?? 30} /></Field>
      <Field label="Tax rate override (basis points)" name="taxRateBps" hint="825 = 8.25%. Blank uses the company default."><Input inputMode="numeric" defaultValue={profile?.taxRateBps ?? ""} /></Field>
      <Field label="Partial payments" name="allowPartialPayments"><Select defaultValue={profile?.allowPartialPayments === null || profile?.allowPartialPayments === undefined ? "inherit" : profile.allowPartialPayments ? "yes" : "no"}><option value="inherit">Company default</option><option value="yes">Allowed</option><option value="no">Not allowed</option></Select></Field>
      <Field label="PO number" name="poNumber"><Input defaultValue={profile?.poNumber ?? ""} /></Field>
      <div className="flex gap-4 text-sm sm:col-span-2">
        <label className="flex items-center gap-2"><Checkbox name="taxExempt" defaultChecked={profile?.taxExempt} /> Tax exempt</label>
        <label className="flex items-center gap-2"><Checkbox name="isDefault" defaultChecked={profile?.isDefault} /> Default profile</label>
      </div>
      <div className="sm:col-span-2"><SubmitButton>Save billing profile</SubmitButton></div>
    </ActionForm>
  );
}

export type PlanInit = {
  id: string; name: string; serviceType: string; unit: string; interval: number; anchor: string; startDate: string; endDate: string | null; specificDates: string; preferredWindowStart: string | null; preferredWindowEnd: string | null; pricingModel: string; flatPriceCents: number | null; perGallon: string | null; minimumChargeCents: number | null; territory: string | null; defaultDriverId: string | null; defaultVehicleId: string | null; specialInstructions: string | null; assetIds: string[];
};

export function PlanForm({ locationId, assets, drivers, vehicles, plan, today, onDone }: { locationId: string; assets: { id: string; label: string }[]; drivers: { id: string; name: string }[]; vehicles: { id: string; unitNumber: string }[]; plan?: PlanInit; today: string; onDone?: () => void }) {
  const presetKey = plan ? Object.entries(FREQUENCY_PRESETS).find(([, p]) => p.unit === plan.unit && p.interval === plan.interval)?.[0] ?? (plan.unit === "SPECIFIC_DATES" ? "specific" : "custom") : "every_30_days";
  const [preset, setPreset] = React.useState(presetKey);
  const [pricing, setPricing] = React.useState(plan?.pricingModel ?? "PER_GALLON");
  const p = preset in FREQUENCY_PRESETS ? FREQUENCY_PRESETS[preset as keyof typeof FREQUENCY_PRESETS] : null;
  return (
    <ActionForm action={savePlanAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone}>
      <input type="hidden" name="locationId" value={locationId} />
      {plan && <input type="hidden" name="planId" value={plan.id} />}
      <Field label="Plan name" name="name" required className="sm:col-span-2"><Input defaultValue={plan?.name} placeholder="Monthly interceptor service" /></Field>
      <Field label="Service type" name="serviceType" required><Select defaultValue={plan?.serviceType ?? "INTERCEPTOR_PUMPING"}>{Object.entries(SERVICE_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label="Frequency" name="_preset">
        <Select value={preset} onChange={(e) => setPreset(e.target.value)}>
          {Object.entries(FREQUENCY_PRESETS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          <option value="custom">Custom interval</option>
          <option value="specific">Specific calendar dates</option>
        </Select>
      </Field>
      {p && <><input type="hidden" name="unit" value={p.unit} /><input type="hidden" name="interval" value={p.interval} /></>}
      {preset === "custom" && (
        <div className="grid grid-cols-2 gap-3 sm:col-span-2">
          <Field label="Every" name="interval" required><Input inputMode="numeric" defaultValue={plan?.interval ?? 45} /></Field>
          <Field label="Unit" name="unit"><Select defaultValue={plan && plan.unit !== "SPECIFIC_DATES" ? plan.unit : "DAY"}><option value="DAY">Days</option><option value="WEEK">Weeks</option><option value="MONTH">Months</option></Select></Field>
        </div>
      )}
      {preset === "specific" ? (
        <>
          <input type="hidden" name="unit" value="SPECIFIC_DATES" />
          <input type="hidden" name="anchor" value="FIXED_CALENDAR" />
          <Field label="Service dates" name="specificDates" required className="sm:col-span-2" hint="One per line or comma-separated, YYYY-MM-DD."><Textarea rows={3} defaultValue={plan?.specificDates ?? ""} /></Field>
        </>
      ) : (
        <Field label="Scheduling policy" name="anchor" required className="sm:col-span-2" hint="Fixed calendar keeps contractual dates even if a visit runs late. From completion schedules the next visit relative to the actual service date.">
          <Select defaultValue={plan?.anchor ?? "FIXED_CALENDAR"}><option value="FIXED_CALENDAR">Fixed calendar (contract dates)</option><option value="COMPLETION_DATE">From completion date</option></Select>
        </Field>
      )}
      <Field label={preset === "specific" ? "Start date" : "First service / anchor date"} name="startDate" required><Input type="date" defaultValue={plan?.startDate ?? today} /></Field>
      <Field label="End date (optional)" name="endDate"><Input type="date" defaultValue={plan?.endDate ?? ""} /></Field>
      <Field label="Preferred window start" name="preferredWindowStart"><Input type="time" defaultValue={plan?.preferredWindowStart ?? ""} /></Field>
      <Field label="Preferred window end" name="preferredWindowEnd"><Input type="time" defaultValue={plan?.preferredWindowEnd ?? ""} /></Field>
      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-[13px] font-medium">Equipment covered <span className="text-danger">*</span></legend>
        {assets.length === 0 && <p className="text-[13px] text-muted-foreground">Add equipment to this location first.</p>}
        <div className="flex flex-wrap gap-4">{assets.map((a) => <label key={a.id} className="flex items-center gap-2 text-sm"><Checkbox name="assetIds[]" value={a.id} defaultChecked={plan ? plan.assetIds.includes(a.id) : true} /> {a.label}</label>)}</div>
      </fieldset>
      <Field label="Pricing" name="pricingModel" required><Select value={pricing} onChange={(e) => setPricing(e.target.value)}><option value="PER_GALLON">Per gallon</option><option value="FLAT_RATE">Flat rate</option></Select></Field>
      {pricing === "FLAT_RATE" ? (
        <Field label="Contracted price ($)" name="flatPrice" hint="Blank = use company pricing rules."><Input inputMode="decimal" defaultValue={centsToDollarInput(plan?.flatPriceCents)} /></Field>
      ) : (
        <Field label="Contracted rate ($/gal)" name="perGallonPrice" hint="Blank = use company pricing rules."><Input inputMode="decimal" defaultValue={plan?.perGallon ?? ""} placeholder="0.30" /></Field>
      )}
      <Field label="Minimum charge ($)" name="minimumCharge"><Input inputMode="decimal" defaultValue={centsToDollarInput(plan?.minimumChargeCents)} /></Field>
      <Field label="Route / territory" name="territory"><Input defaultValue={plan?.territory ?? ""} /></Field>
      <Field label="Default driver" name="defaultDriverId"><Select defaultValue={plan?.defaultDriverId ?? ""}><option value="">Assign on dispatch board</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
      <Field label="Default truck" name="defaultVehicleId"><Select defaultValue={plan?.defaultVehicleId ?? ""}><option value="">—</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.unitNumber}</option>)}</Select></Field>
      <Field label="Special instructions" name="specialInstructions" className="sm:col-span-2"><Textarea rows={2} defaultValue={plan?.specialInstructions ?? ""} /></Field>
      <p className="text-[12px] text-muted-foreground sm:col-span-2">Intervals are customer-specific service schedules, not regulatory requirements.</p>
      <div className="sm:col-span-2"><SubmitButton>{plan ? "Save plan" : "Create plan"}</SubmitButton></div>
    </ActionForm>
  );
}

export function InviteCustomerUserForm({ organizationId, locations, onDone }: { organizationId: string; locations: { id: string; name: string }[]; onDone?: () => void }) {
  const [role, setRole] = React.useState("LOCATION_MANAGER");
  return (
    <ActionForm action={inviteCustomerUserAction as Act} className="grid gap-4 sm:grid-cols-2" onSuccess={onDone} resetOnSuccess>
      <input type="hidden" name="organizationId" value={organizationId} />
      <Field label="Name" name="name" required><Input /></Field>
      <Field label="Email" name="email" required><Input type="email" /></Field>
      <Field label="Phone" name="phone"><Input type="tel" /></Field>
      <Field label="Role" name="orgRole" required>
        <Select value={role} onChange={(e) => setRole(e.target.value)}><option value="ORG_ADMIN">Organization admin (all locations)</option><option value="LOCATION_MANAGER">Location manager</option><option value="READ_ONLY">Read-only</option></Select>
      </Field>
      {role !== "ORG_ADMIN" && (
        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-[13px] font-medium">Locations this user can access <span className="text-danger">*</span></legend>
          <div className="flex flex-wrap gap-4">{locations.map((l) => <label key={l.id} className="flex items-center gap-2 text-sm"><Checkbox name="locationIds[]" value={l.id} /> {l.name}</label>)}</div>
        </fieldset>
      )}
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><Checkbox name="canPay" defaultChecked={role !== "READ_ONLY"} key={role} /> Can make payments</label>
      <div className="sm:col-span-2"><SubmitButton>Send invitation</SubmitButton></div>
    </ActionForm>
  );
}
