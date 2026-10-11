import { Badge } from "./badge";
import { EMERGENCY_SEVERITY, EMERGENCY_STATUS, INVOICE_STATUS, ISSUE_STATUS, JOB_STATUS, MANIFEST_STATUS, PAYMENT_STATUS, TICKET_STATUS, VEHICLE_STATUS, customerJobStatus } from "@/lib/status";

const MAPS = {
  job: JOB_STATUS,
  manifest: MANIFEST_STATUS,
  invoice: INVOICE_STATUS,
  payment: PAYMENT_STATUS,
  emergency: EMERGENCY_STATUS,
  severity: EMERGENCY_SEVERITY,
  ticket: TICKET_STATUS,
  vehicle: VEHICLE_STATUS,
  issue: ISSUE_STATUS,
} as const;

export function StatusBadge({ kind, status }: { kind: keyof typeof MAPS; status: string }) {
  const meta = MAPS[kind][status] ?? { label: status, tone: "neutral" as const };
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}

export function CustomerJobBadge({ status, confirmedByOffice, rescheduled }: { status: string; confirmedByOffice?: boolean; rescheduled?: boolean }) {
  const meta = customerJobStatus({ status, confirmedByOffice, rescheduled });
  return (
    <Badge tone={meta.tone} dot>
      {meta.label}
    </Badge>
  );
}
