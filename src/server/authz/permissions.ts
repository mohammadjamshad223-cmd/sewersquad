/**
 * Staff permission catalogue. Roles are stored in the database (Role / RolePermission) and seeded
 * from DEFAULT_ROLE_PERMISSIONS; super admins can adjust non-system grants in Settings → Roles.
 *
 * Customer users do not have staff roles. Their access is governed by OrganizationMembership
 * (ORG_ADMIN / LOCATION_MANAGER / READ_ONLY) and LocationMembership — see ./scope.ts.
 */
export const PERMISSIONS = {
  "customers.read": { group: "Customers", description: "View customer organizations, locations and equipment" },
  "customers.write": { group: "Customers", description: "Create and edit customers, locations, contacts and equipment" },
  "customers.deactivate": { group: "Customers", description: "Deactivate customer accounts and locations" },
  "customers.users": { group: "Customers", description: "Invite and manage customer portal users" },

  "plans.write": { group: "Scheduling", description: "Create and edit recurring service plans" },
  "jobs.read": { group: "Scheduling", description: "View jobs and the dispatch board" },
  "jobs.write": { group: "Scheduling", description: "Create, reschedule and cancel jobs" },
  "jobs.dispatch": { group: "Scheduling", description: "Assign drivers and trucks, reorder routes" },
  "jobs.approve": { group: "Scheduling", description: "Review and approve submitted service records" },
  "emergencies.manage": { group: "Scheduling", description: "Triage and dispatch emergency requests" },

  "fleet.read": { group: "Fleet", description: "View drivers, trucks and inspections" },
  "fleet.write": { group: "Fleet", description: "Manage drivers, trucks, maintenance and issues" },
  "disposal.read": { group: "Fleet", description: "View disposal events and reconciliation" },
  "disposal.write": { group: "Fleet", description: "Record and reconcile disposal events" },

  "manifests.read": { group: "Documentation", description: "View manifests" },
  "manifests.review": { group: "Documentation", description: "Approve, reject and correct manifests" },
  "documents.read": { group: "Documentation", description: "View and download documents" },
  "documents.write": { group: "Documentation", description: "Upload and replace documents" },
  "documents.delete": { group: "Documentation", description: "Archive documents" },

  "invoices.read": { group: "Billing", description: "View invoices" },
  "invoices.write": { group: "Billing", description: "Create, edit and send invoices" },
  "invoices.void": { group: "Billing", description: "Void or write off invoices" },
  "payments.read": { group: "Billing", description: "View payments" },
  "payments.record": { group: "Billing", description: "Record manual payments (check, cash)" },
  "payments.refund": { group: "Billing", description: "Issue refunds" },
  "expenses.read": { group: "Billing", description: "View external costs (gas, contractors, tools, permits)" },
  "expenses.write": { group: "Billing", description: "Record and edit external costs" },

  "reports.operations": { group: "Reporting", description: "View operational reports and dashboards" },
  "reports.financial": { group: "Reporting", description: "View financial reports, receivables and profitability" },

  "support.manage": { group: "Support", description: "View and respond to customer inquiries" },

  "settings.read": { group: "Administration", description: "View company settings" },
  "settings.write": { group: "Administration", description: "Change company settings, pricing and templates" },
  "staff.manage": { group: "Administration", description: "Invite staff, change roles and permissions" },
  "audit.read": { group: "Administration", description: "View the audit log" },

  "driver.portal": { group: "Field", description: "Use the driver portal for assigned jobs" },
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const SYSTEM_ROLES = {
  super_admin: { name: "Super Admin", description: "Full platform access including security settings" },
  admin: { name: "Admin", description: "Customers, operations, scheduling, documents and billing" },
  dispatcher: { name: "Dispatcher", description: "Schedules, jobs, drivers, trucks and emergencies" },
  accounting: { name: "Accounting", description: "Invoices, payments, collections and financial reports" },
  driver: { name: "Driver", description: "Assigned jobs, service records, manifests and inspections" },
} as const;

export type SystemRoleKey = keyof typeof SYSTEM_ROLES;

export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRoleKey, Permission[]> = {
  super_admin: ALL_PERMISSIONS.filter((p) => p !== "driver.portal"),
  admin: ALL_PERMISSIONS.filter((p) => !["staff.manage", "driver.portal"].includes(p)),
  dispatcher: [
    "customers.read",
    "plans.write",
    "jobs.read",
    "jobs.write",
    "jobs.dispatch",
    "jobs.approve",
    "emergencies.manage",
    "fleet.read",
    "fleet.write",
    "disposal.read",
    "disposal.write",
    "manifests.read",
    "manifests.review",
    "documents.read",
    "documents.write",
    "reports.operations",
    "support.manage",
  ],
  accounting: [
    "customers.read",
    "jobs.read",
    "manifests.read",
    "documents.read",
    "documents.write",
    "invoices.read",
    "invoices.write",
    "invoices.void",
    "payments.read",
    "payments.record",
    "payments.refund",
    "expenses.read",
    "expenses.write",
    "disposal.read",
    "reports.financial",
    "reports.operations",
    "support.manage",
  ],
  driver: ["driver.portal"],
};

/** Roles that must use MFA when REQUIRE_ADMIN_MFA=true. */
export const PRIVILEGED_ROLES: SystemRoleKey[] = ["super_admin", "admin", "accounting"];
