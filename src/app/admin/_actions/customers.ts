"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { assertStaff } from "@/server/authz/guards";
import { formAction, runAction, type ActionResult } from "@/server/action";
import * as customers from "@/server/services/customers";
import { createPlan, planSchema, setPlanStatus, updatePlan } from "@/server/services/plans";
import { inviteUser, setUserActive, invitationResult } from "@/server/services/auth";
import { processDueDeliveries } from "@/server/services/notifications";
import { badRequest } from "@/server/errors";
import { prisma } from "@/server/db";
import { audit } from "@/server/audit";

const id = z.string().uuid();

const _createOrg = formAction(customers.organizationSchema, async (input) => {
  const actor = await assertStaff("customers.write");
  const org = await customers.createOrganization(actor, input);
  redirect(`/admin/customers/${org.id}?created=1`);
});
export async function createOrganizationAction(p: ActionResult, fd: FormData) { return _createOrg(p, fd); }

const _updateOrg = formAction(customers.organizationSchema.extend({ id }), async ({ id, ...input }) => {
  const actor = await assertStaff("customers.write");
  await customers.updateOrganization(actor, id, input);
  return { ok: true, message: "Customer updated." };
});
export async function updateOrganizationAction(p: ActionResult, fd: FormData) { return _updateOrg(p, fd); }

const _orgStatus = formAction(z.object({ id, active: z.enum(["true", "false"]), reason: z.string().trim().default("") }), async (i) => {
  const actor = await assertStaff("customers.deactivate");
  await customers.setOrganizationStatus(actor, i.id, i.active === "true", i.reason);
  return { ok: true, message: i.active === "true" ? "Account reactivated." : "Account deactivated and recurring plans paused." };
});
export async function setOrganizationStatusAction(p: ActionResult, fd: FormData) { return _orgStatus(p, fd); }

const _createLoc = formAction(customers.locationSchema.extend({ organizationId: id }), async ({ organizationId, ...input }) => {
  const actor = await assertStaff("customers.write");
  const loc = await customers.createLocation(actor, organizationId, input);
  redirect(`/admin/locations/${loc.id}?created=1`);
});
export async function createLocationAction(p: ActionResult, fd: FormData) { return _createLoc(p, fd); }

const _updateLoc = formAction(customers.locationSchema.extend({ id }), async ({ id, ...input }) => {
  const actor = await assertStaff("customers.write");
  await customers.updateLocation(actor, id, input);
  return { ok: true, message: "Location updated." };
});
export async function updateLocationAction(p: ActionResult, fd: FormData) { return _updateLoc(p, fd); }

const _locStatus = formAction(z.object({ id, active: z.enum(["true", "false"]), reason: z.string().trim().default("") }), async (i) => {
  const actor = await assertStaff("customers.deactivate");
  await customers.setLocationStatus(actor, i.id, i.active === "true", i.reason);
  return { ok: true, message: "Location status updated." };
});
export async function setLocationStatusAction(p: ActionResult, fd: FormData) { return _locStatus(p, fd); }

const _contact = formAction(customers.contactSchema.extend({ organizationId: id, contactId: id.optional().or(z.literal("").transform(() => undefined)) }), async ({ organizationId, contactId, ...input }) => {
  const actor = await assertStaff("customers.write");
  await customers.upsertContact(actor, organizationId, contactId ?? null, input);
  return { ok: true, message: "Contact saved." };
});
export async function saveContactAction(p: ActionResult, fd: FormData) { return _contact(p, fd); }

export async function deleteContactAction(organizationId: string, contactId: string) {
  return runAction(async () => customers.deleteContact(await assertStaff("customers.write"), organizationId, contactId));
}

const _billing = formAction(customers.billingProfileSchema.extend({ organizationId: id, profileId: id.optional().or(z.literal("").transform(() => undefined)) }), async ({ organizationId, profileId, ...input }) => {
  const actor = await assertStaff(["customers.write", "invoices.write"]);
  await customers.upsertBillingProfile(actor, organizationId, profileId ?? null, input);
  return { ok: true, message: "Billing profile saved." };
});
export async function saveBillingProfileAction(p: ActionResult, fd: FormData) { return _billing(p, fd); }

const _asset = formAction(customers.assetSchema.extend({ locationId: id.optional(), assetId: id.optional().or(z.literal("").transform(() => undefined)), status: z.enum(["ACTIVE", "INACTIVE"]).optional() }), async ({ locationId, assetId, status, ...input }) => {
  const actor = await assertStaff("customers.write");
  if (assetId) await customers.updateAsset(actor, assetId, { ...input, ...(status ? { status } : {}) });
  else if (locationId) await customers.createAsset(actor, locationId, input);
  else throw badRequest("Location required.");
  return { ok: true, message: "Equipment saved." };
});
export async function saveAssetAction(p: ActionResult, fd: FormData) { return _asset(p, fd); }

const _plan = formAction(planSchema.and(z.object({ planId: id.optional().or(z.literal("").transform(() => undefined)) })), async (input) => {
  const actor = await assertStaff("plans.write");
  if (input.planId) {
    await updatePlan(actor, input.planId, input);
    return { ok: true, message: "Plan updated. The already scheduled visit keeps its date; changes apply from the next occurrence." };
  }
  await createPlan(actor, input);
  after(() => processDueDeliveries());
  return { ok: true, message: "Recurring plan created and the next visit scheduled." };
});
export async function savePlanAction(p: ActionResult, fd: FormData) { return _plan(p, fd); }

const _planStatus = formAction(z.object({ planId: id, status: z.enum(["ACTIVE", "PAUSED", "ENDED"]), reason: z.string().trim().min(3, "Give a reason.") }), async (i) => {
  const actor = await assertStaff("plans.write");
  await setPlanStatus(actor, i.planId, i.status, i.reason);
  return { ok: true, message: `Plan ${i.status.toLowerCase()}.` };
});
export async function setPlanStatusAction(p: ActionResult, fd: FormData) { return _planStatus(p, fd); }

const _inviteCustomer = formAction(
  z.object({ organizationId: id, email: z.string().trim().email(), name: z.string().trim().min(2), phone: z.string().trim().optional(), orgRole: z.enum(["ORG_ADMIN", "LOCATION_MANAGER", "READ_ONLY"]), canPay: z.enum(["on"]).optional(), locationIds: z.array(id).default([]) }),
  async (i) => {
    const actor = await assertStaff("customers.users");
    const { token } = await inviteUser(actor, { kind: "CUSTOMER", email: i.email, name: i.name, phone: i.phone, organizationId: i.organizationId, orgRole: i.orgRole, canPay: i.canPay === "on", locationIds: i.locationIds });
    after(() => processDueDeliveries());
    return invitationResult(i.email, token);
  },
);
export async function inviteCustomerUserAction(p: ActionResult, fd: FormData) { return _inviteCustomer(p, fd); }

export async function setUserActiveAction(userId: string, active: boolean) {
  return runAction(async () => setUserActive(await assertStaff(), userId, active));
}

export async function removeMembershipAction(organizationId: string, userId: string) {
  return runAction(async () => {
    const actor = await assertStaff("customers.users");
    await prisma.$transaction(async (tx) => {
      await tx.locationMembership.deleteMany({ where: { userId, location: { organizationId } } });
      await tx.organizationMembership.deleteMany({ where: { organizationId, userId } });
      await audit(tx, { actorId: actor.userId, action: "user.membership_remove", entityType: "User", entityId: userId, organizationId });
    });
  });
}
