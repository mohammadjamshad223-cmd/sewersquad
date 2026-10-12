import type { BadgeTone } from "@/components/ui/badge";

type Meta = { label: string; tone: BadgeTone };

export const JOB_STATUS: Record<string, Meta> = {
  SCHEDULED: { label: "Scheduled", tone: "neutral" },
  ASSIGNED: { label: "Assigned", tone: "brand" },
  ACCEPTED: { label: "Accepted", tone: "brand" },
  EN_ROUTE: { label: "En Route", tone: "info" },
  ARRIVED: { label: "Arrived", tone: "info" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  PENDING_DOCUMENTATION: { label: "Pending Documentation", tone: "warning" },
  SUBMITTED: { label: "Submitted for Review", tone: "warning" },
  COMPLETED: { label: "Completed", tone: "success" },
  UNABLE_TO_SERVICE: { label: "Unable to Service", tone: "danger" },
  MISSED: { label: "Missed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

/**
 * Customer-facing service status. Internal workflow detail (accepted, pending documentation,
 * office review) is collapsed into the statuses customers care about.
 */
export function customerJobStatus(job: { status: string; confirmedByOffice?: boolean; rescheduled?: boolean }): Meta {
  switch (job.status) {
    case "SCHEDULED":
      return job.rescheduled ? { label: "Rescheduled", tone: "warning" } : { label: job.confirmedByOffice ? "Confirmed" : "Scheduled", tone: job.confirmedByOffice ? "brand" : "neutral" };
    case "ASSIGNED":
    case "ACCEPTED":
      return job.rescheduled ? { label: "Rescheduled", tone: "warning" } : { label: "Confirmed", tone: "brand" };
    case "EN_ROUTE":
      return { label: "Driver En Route", tone: "info" };
    case "ARRIVED":
    case "IN_PROGRESS":
    case "PENDING_DOCUMENTATION":
      return { label: "In Progress", tone: "info" };
    case "SUBMITTED":
    case "COMPLETED":
      return { label: "Completed", tone: "success" };
    case "UNABLE_TO_SERVICE":
    case "MISSED":
      return { label: "Rescheduling", tone: "warning" };
    case "CANCELLED":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: job.status, tone: "neutral" };
  }
}

export const MANIFEST_STATUS: Record<string, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  PENDING_DRIVER: { label: "Pending Driver Completion", tone: "warning" },
  SUBMITTED: { label: "Submitted", tone: "info" },
  PENDING_REVIEW: { label: "Pending Review", tone: "warning" },
  APPROVED: { label: "Approved", tone: "brand" },
  REJECTED: { label: "Needs Correction", tone: "danger" },
  FINALIZED: { label: "Finalized", tone: "success" },
};

export const INVOICE_STATUS: Record<string, Meta> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SENT: { label: "Sent", tone: "info" },
  VIEWED: { label: "Viewed", tone: "info" },
  PARTIALLY_PAID: { label: "Partially Paid", tone: "warning" },
  PAID: { label: "Paid", tone: "success" },
  OVERDUE: { label: "Overdue", tone: "danger" },
  VOID: { label: "Voided", tone: "neutral" },
  WRITTEN_OFF: { label: "Written Off", tone: "neutral" },
};

export const PAYMENT_STATUS: Record<string, Meta> = {
  PENDING: { label: "Pending", tone: "neutral" },
  PROCESSING: { label: "Processing", tone: "info" },
  SUCCEEDED: { label: "Succeeded", tone: "success" },
  FAILED: { label: "Failed", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
  REFUNDED: { label: "Refunded", tone: "neutral" },
  PARTIALLY_REFUNDED: { label: "Partially Refunded", tone: "warning" },
  DISPUTED: { label: "Disputed", tone: "danger" },
};

export const EMERGENCY_STATUS: Record<string, Meta> = {
  SUBMITTED: { label: "Submitted", tone: "danger" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "warning" },
  CONTACTING_CUSTOMER: { label: "Contacting Customer", tone: "warning" },
  AWAITING_APPROVAL: { label: "Awaiting Approval", tone: "warning" },
  DISPATCHED: { label: "Dispatched", tone: "brand" },
  EN_ROUTE: { label: "En Route", tone: "info" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  COMPLETED: { label: "Completed", tone: "success" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const EMERGENCY_SEVERITY: Record<string, Meta> = {
  URGENT: { label: "Urgent", tone: "danger" },
  HIGH: { label: "High", tone: "warning" },
  STANDARD: { label: "Standard", tone: "neutral" },
};

export const TICKET_STATUS: Record<string, Meta> = {
  OPEN: { label: "Open", tone: "danger" },
  IN_PROGRESS: { label: "In Progress", tone: "info" },
  WAITING_ON_CUSTOMER: { label: "Waiting on Customer", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
  CLOSED: { label: "Closed", tone: "neutral" },
};

export const VEHICLE_STATUS: Record<string, Meta> = {
  AVAILABLE: { label: "Available", tone: "success" },
  ASSIGNED: { label: "Assigned", tone: "brand" },
  IN_SERVICE: { label: "In Service", tone: "info" },
  MAINTENANCE: { label: "Maintenance", tone: "warning" },
  OUT_OF_SERVICE: { label: "Out of Service", tone: "danger" },
};

export const ISSUE_STATUS: Record<string, Meta> = {
  OPEN: { label: "Open", tone: "danger" },
  ACKNOWLEDGED: { label: "Acknowledged", tone: "warning" },
  RESOLVED: { label: "Resolved", tone: "success" },
};

export const SERVICE_TYPE_LABEL: Record<string, string> = {
  GREASE_TRAP_PUMPING: "Grease Trap Pumping",
  INTERCEPTOR_PUMPING: "Grease Interceptor Pumping",
  SEPTIC_PUMPING: "Septic Pumping",
  GRIT_TRAP_CLEANING: "Grit Trap Cleaning",
  LINT_TRAP_CLEANING: "Lint Trap Cleaning",
  LIFT_STATION_SERVICE: "Lift Station Service",
  HYDRO_JETTING: "Hydro Jetting",
  LINE_CLEANING: "Line Cleaning",
  INSPECTION: "Inspection",
  OTHER: "Other Service",
};

export const ASSET_TYPE_LABEL: Record<string, string> = {
  GREASE_TRAP: "Grease Trap",
  GREASE_INTERCEPTOR: "Grease Interceptor",
  SEPTIC_TANK: "Septic Tank",
  GRIT_TRAP: "Grit Trap",
  LINT_TRAP: "Lint Trap",
  LIFT_STATION: "Lift Station",
  OTHER: "Other",
};

export const EMERGENCY_CATEGORY_LABEL: Record<string, string> = {
  TRAP_OVERFLOWING: "Grease trap overflowing",
  DRAIN_BACKUP: "Drain backup",
  INTERCEPTOR_FULL: "Grease interceptor full",
  URGENT_PUMPING: "Urgent pumping",
  SEPTIC_ISSUE: "Septic issue",
  GRIT_WASTEWATER: "Grit or wastewater issue",
  OTHER: "Other",
};

export const WASTE_TYPES = ["Grease trap waste", "Septic waste", "Grit trap waste", "Lint trap waste", "Lift station waste", "Other non-hazardous liquid waste"] as const;

export const ORG_ROLE_LABEL: Record<string, string> = {
  ORG_ADMIN: "Organization Admin",
  LOCATION_MANAGER: "Location Manager",
  READ_ONLY: "Read-only",
};

export const LINE_ITEM_KIND_LABEL: Record<string, string> = {
  SERVICE: "Service",
  PER_GALLON: "Per gallon",
  FLAT_RATE: "Flat rate",
  MINIMUM_CHARGE: "Minimum charge",
  EMERGENCY_SURCHARGE: "Emergency surcharge",
  AFTER_HOURS: "After-hours",
  ADDITIONAL_EQUIPMENT: "Additional equipment",
  DISPOSAL_FEE: "Disposal fee",
  MANIFEST_FEE: "Manifest fee (auto %)",
  DISCOUNT: "Discount",
  LATE_FEE: "Late fee",
  OTHER: "Other",
};

export const PROPOSAL_TONE = { DRAFT: "neutral", SENT: "info", ACCEPTED: "success", DECLINED: "danger" } as const;
export const REPORT_TONE = { DRAFT: "neutral", FINAL: "success" } as const;
