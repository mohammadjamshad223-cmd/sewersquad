import { addDays, addMonths, compareKeys, type DateKey } from "@/lib/dates";

/**
 * Recurring schedule engine (pure, deterministic, time-zone free — operates on calendar dates).
 *
 * Policies
 *  - FIXED_CALENDAR: occurrences are anchorDate + k·interval. Completing a visit early or late, or
 *    rescheduling a job, never moves the contractual series. The next occurrence is the first
 *    series date strictly after the occurrence just fulfilled (or skipped).
 *  - COMPLETION_DATE: the next occurrence is the actual completion date + interval.
 *  - SPECIFIC_DATES: an explicit list of calendar dates.
 */
export type RecurrenceUnit = "DAY" | "WEEK" | "MONTH" | "SPECIFIC_DATES";
export type RecurrenceAnchor = "FIXED_CALENDAR" | "COMPLETION_DATE";

export type Rule = {
  unit: RecurrenceUnit;
  interval: number;
  anchor: RecurrenceAnchor;
  anchorDate: DateKey;
  specificDates?: DateKey[];
};

export const FREQUENCY_PRESETS = {
  every_30_days: { label: "Every 30 days", unit: "DAY", interval: 30 },
  every_60_days: { label: "Every 60 days", unit: "DAY", interval: 60 },
  every_90_days: { label: "Every 90 days", unit: "DAY", interval: 90 },
  weekly: { label: "Weekly", unit: "WEEK", interval: 1 },
  biweekly: { label: "Every 2 weeks", unit: "WEEK", interval: 2 },
  monthly: { label: "Monthly", unit: "MONTH", interval: 1 },
  quarterly: { label: "Quarterly", unit: "MONTH", interval: 3 },
  semiannual: { label: "Every 6 months", unit: "MONTH", interval: 6 },
} as const satisfies Record<string, { label: string; unit: RecurrenceUnit; interval: number }>;

export function validateRule(rule: Rule): string | null {
  if (rule.unit === "SPECIFIC_DATES") {
    if (!rule.specificDates || rule.specificDates.length === 0) return "Add at least one service date.";
    return null;
  }
  if (!Number.isInteger(rule.interval) || rule.interval < 1) return "Interval must be a whole number of at least 1.";
  if (rule.unit === "DAY" && rule.interval > 730) return "Interval cannot exceed 730 days.";
  if (rule.unit === "WEEK" && rule.interval > 104) return "Interval cannot exceed 104 weeks.";
  if (rule.unit === "MONTH" && rule.interval > 24) return "Interval cannot exceed 24 months.";
  return null;
}

/** The k-th occurrence of a fixed series (k = 0 is the anchor). */
export function nthOccurrence(rule: Rule, k: number): DateKey {
  switch (rule.unit) {
    case "DAY":
      return addDays(rule.anchorDate, k * rule.interval);
    case "WEEK":
      return addDays(rule.anchorDate, k * rule.interval * 7);
    case "MONTH": {
      const anchorDay = Number(rule.anchorDate.slice(8, 10));
      return addMonths(rule.anchorDate, k * rule.interval, anchorDay);
    }
    case "SPECIFIC_DATES":
      throw new Error("nthOccurrence is not defined for SPECIFIC_DATES");
  }
}

function addInterval(rule: Rule, from: DateKey): DateKey {
  switch (rule.unit) {
    case "DAY":
      return addDays(from, rule.interval);
    case "WEEK":
      return addDays(from, rule.interval * 7);
    case "MONTH":
      return addMonths(from, rule.interval);
    case "SPECIFIC_DATES":
      throw new Error("addInterval is not defined for SPECIFIC_DATES");
  }
}

/** First occurrence on or after `onOrAfter` (used when a plan is created or resumed). */
export function firstOccurrenceOnOrAfter(rule: Rule, onOrAfter: DateKey): DateKey | null {
  if (rule.unit === "SPECIFIC_DATES") {
    return [...(rule.specificDates ?? [])].sort().find((d) => compareKeys(d, onOrAfter) >= 0) ?? null;
  }
  if (rule.anchor === "COMPLETION_DATE") {
    return compareKeys(rule.anchorDate, onOrAfter) >= 0 ? rule.anchorDate : onOrAfter;
  }
  if (compareKeys(rule.anchorDate, onOrAfter) >= 0) return rule.anchorDate;
  // Estimate k, then correct — avoids iterating thousands of steps for long-running plans.
  const approxDays = rule.unit === "DAY" ? rule.interval : rule.unit === "WEEK" ? rule.interval * 7 : rule.interval * 30;
  const elapsed = (Date.parse(`${onOrAfter}T00:00:00Z`) - Date.parse(`${rule.anchorDate}T00:00:00Z`)) / 86_400_000;
  let k = Math.max(0, Math.floor(elapsed / approxDays) - 2);
  for (let guard = 0; guard < 10_000; guard++, k++) {
    const d = nthOccurrence(rule, k);
    if (compareKeys(d, onOrAfter) >= 0) return d;
  }
  throw new Error("Recurrence did not converge");
}

/**
 * Next occurrence after a visit.
 * @param occurrence  the series date the finished/skipped job fulfilled (not its rescheduled date)
 * @param completedOn the calendar date the work was actually completed (COMPLETION_DATE plans)
 */
export function nextOccurrence(rule: Rule, occurrence: DateKey, completedOn?: DateKey | null): DateKey | null {
  if (rule.unit === "SPECIFIC_DATES") {
    return [...(rule.specificDates ?? [])].sort().find((d) => compareKeys(d, occurrence) > 0) ?? null;
  }
  if (rule.anchor === "COMPLETION_DATE") {
    return addInterval(rule, completedOn ?? occurrence);
  }
  const after = addDays(occurrence, 1);
  return firstOccurrenceOnOrAfter(rule, after);
}

/** Upcoming occurrences for previews ("Next 6 visits"). COMPLETION_DATE previews assume on-time completion. */
export function previewOccurrences(rule: Rule, from: DateKey, count: number): DateKey[] {
  const out: DateKey[] = [];
  let cur = firstOccurrenceOnOrAfter(rule, from);
  while (cur && out.length < count) {
    out.push(cur);
    cur = nextOccurrence(rule, cur, cur);
  }
  return out;
}

export function describeRule(rule: Pick<Rule, "unit" | "interval" | "anchor">): string {
  const preset = Object.values(FREQUENCY_PRESETS).find((p) => p.unit === rule.unit && p.interval === rule.interval);
  const base =
    rule.unit === "SPECIFIC_DATES"
      ? "Specific dates"
      : preset
        ? preset.label
        : `Every ${rule.interval} ${rule.unit === "DAY" ? "days" : rule.unit === "WEEK" ? "weeks" : "months"}`;
  return rule.unit === "SPECIFIC_DATES" ? base : `${base} · ${rule.anchor === "FIXED_CALENDAR" ? "fixed calendar" : "from completion"}`;
}
