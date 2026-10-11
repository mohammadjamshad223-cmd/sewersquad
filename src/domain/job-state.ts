/**
 * Job status state machine. Every status change in the system goes through `assertTransition`.
 */
export type JobStatus =
  | "SCHEDULED"
  | "ASSIGNED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "PENDING_DOCUMENTATION"
  | "SUBMITTED"
  | "COMPLETED"
  | "UNABLE_TO_SERVICE"
  | "MISSED"
  | "CANCELLED";

export type TransitionActor = "dispatch" | "driver" | "reviewer" | "system";

type Edge = { to: JobStatus; by: TransitionActor[] };

const EDGES: Record<JobStatus, Edge[]> = {
  SCHEDULED: [
    { to: "ASSIGNED", by: ["dispatch"] },
    { to: "CANCELLED", by: ["dispatch"] },
    { to: "MISSED", by: ["dispatch", "system"] },
  ],
  ASSIGNED: [
    { to: "ACCEPTED", by: ["driver"] },
    { to: "EN_ROUTE", by: ["driver"] },
    { to: "SCHEDULED", by: ["dispatch"] }, // unassign
    { to: "CANCELLED", by: ["dispatch"] },
    { to: "MISSED", by: ["dispatch", "system"] },
    { to: "UNABLE_TO_SERVICE", by: ["driver"] },
  ],
  ACCEPTED: [
    { to: "EN_ROUTE", by: ["driver"] },
    { to: "SCHEDULED", by: ["dispatch"] },
    { to: "CANCELLED", by: ["dispatch"] },
    { to: "MISSED", by: ["dispatch", "system"] },
    { to: "UNABLE_TO_SERVICE", by: ["driver"] },
  ],
  EN_ROUTE: [
    { to: "ARRIVED", by: ["driver"] },
    { to: "ACCEPTED", by: ["driver"] }, // turned back
    { to: "UNABLE_TO_SERVICE", by: ["driver"] },
    { to: "CANCELLED", by: ["dispatch"] },
  ],
  ARRIVED: [
    { to: "IN_PROGRESS", by: ["driver"] },
    { to: "UNABLE_TO_SERVICE", by: ["driver"] },
  ],
  IN_PROGRESS: [
    { to: "PENDING_DOCUMENTATION", by: ["driver"] },
    { to: "UNABLE_TO_SERVICE", by: ["driver"] },
  ],
  PENDING_DOCUMENTATION: [
    { to: "SUBMITTED", by: ["driver"] },
    { to: "IN_PROGRESS", by: ["driver"] },
  ],
  SUBMITTED: [
    { to: "COMPLETED", by: ["reviewer"] },
    { to: "PENDING_DOCUMENTATION", by: ["reviewer"] }, // sent back for correction
  ],
  COMPLETED: [],
  UNABLE_TO_SERVICE: [
    { to: "SCHEDULED", by: ["dispatch"] }, // rescheduled
    { to: "CANCELLED", by: ["dispatch"] },
  ],
  MISSED: [
    { to: "SCHEDULED", by: ["dispatch"] },
    { to: "CANCELLED", by: ["dispatch"] },
  ],
  CANCELLED: [],
};

export function canTransition(from: JobStatus, to: JobStatus, by: TransitionActor): boolean {
  return EDGES[from].some((e) => e.to === to && e.by.includes(by));
}

export class TransitionError extends Error {
  constructor(public from: JobStatus, public to: JobStatus) {
    super(`A job cannot move from ${from.replace(/_/g, " ").toLowerCase()} to ${to.replace(/_/g, " ").toLowerCase()}.`);
    this.name = "TransitionError";
  }
}

export function assertTransition(from: JobStatus, to: JobStatus, by: TransitionActor) {
  if (!canTransition(from, to, by)) throw new TransitionError(from, to);
}

export function allowedNext(from: JobStatus, by: TransitionActor): JobStatus[] {
  return EDGES[from].filter((e) => e.by.includes(by)).map((e) => e.to);
}

export const OPEN_JOB_STATUSES: JobStatus[] = ["SCHEDULED", "ASSIGNED", "ACCEPTED", "EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"];
export const ACTIVE_FIELD_STATUSES: JobStatus[] = ["EN_ROUTE", "ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"];
export const DONE_JOB_STATUSES: JobStatus[] = ["SUBMITTED", "COMPLETED"];
/** Driver may edit service documentation only in these states. */
export const DRIVER_EDITABLE_STATUSES: JobStatus[] = ["ARRIVED", "IN_PROGRESS", "PENDING_DOCUMENTATION"];

/** Emergency request status machine (simpler, dispatch-driven). */
export type EmergencyStatus =
  | "SUBMITTED"
  | "ACKNOWLEDGED"
  | "CONTACTING_CUSTOMER"
  | "AWAITING_APPROVAL"
  | "DISPATCHED"
  | "EN_ROUTE"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

const EMERGENCY_EDGES: Record<EmergencyStatus, EmergencyStatus[]> = {
  SUBMITTED: ["ACKNOWLEDGED", "CONTACTING_CUSTOMER", "CANCELLED"],
  ACKNOWLEDGED: ["CONTACTING_CUSTOMER", "AWAITING_APPROVAL", "DISPATCHED", "CANCELLED"],
  CONTACTING_CUSTOMER: ["AWAITING_APPROVAL", "DISPATCHED", "CANCELLED"],
  AWAITING_APPROVAL: ["CONTACTING_CUSTOMER", "DISPATCHED", "CANCELLED"],
  DISPATCHED: ["EN_ROUTE", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  EN_ROUTE: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransitionEmergency(from: EmergencyStatus, to: EmergencyStatus) {
  return EMERGENCY_EDGES[from].includes(to);
}

/** Map a linked job's status onto the emergency request so customers can track it. */
export function emergencyStatusForJob(jobStatus: JobStatus): EmergencyStatus | null {
  switch (jobStatus) {
    case "ASSIGNED":
    case "ACCEPTED":
      return "DISPATCHED";
    case "EN_ROUTE":
      return "EN_ROUTE";
    case "ARRIVED":
    case "IN_PROGRESS":
    case "PENDING_DOCUMENTATION":
    case "SUBMITTED":
      return "IN_PROGRESS";
    case "COMPLETED":
      return "COMPLETED";
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
}
