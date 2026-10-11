/**
 * Date helpers.
 *
 * Two kinds of values exist in this system:
 *  - Calendar dates (service dates, due dates) stored as Postgres DATE. Prisma returns these as
 *    JS Dates at 00:00 UTC. We handle them as "date keys" (YYYY-MM-DD) and never apply a time zone.
 *  - Instants (timestamps) stored in UTC and displayed in the company time zone.
 */
export const DEFAULT_TIME_ZONE = "America/Chicago";

export type DateKey = string; // YYYY-MM-DD

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): value is DateKey {
  if (!DATE_KEY_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Convert a date key into the Date Prisma expects for a @db.Date column. */
export function dateFromKey(key: DateKey): Date {
  if (!isDateKey(key)) throw new Error(`Invalid date: ${key}`);
  return new Date(`${key}T00:00:00Z`);
}

/** Convert a @db.Date value back into a date key. */
export function keyFromDate(d: Date): DateKey {
  return d.toISOString().slice(0, 10);
}

/** The calendar date "now" in a given time zone. */
export function todayKey(timeZone: string = DEFAULT_TIME_ZONE, now: Date = new Date()): DateKey {
  return instantToDateKey(now, timeZone);
}

/** The calendar date of an instant, as observed in a time zone. */
export function instantToDateKey(instant: Date, timeZone: string = DEFAULT_TIME_ZONE): DateKey {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function addDays(key: DateKey, days: number): DateKey {
  const d = dateFromKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return keyFromDate(d);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Add calendar months, clamping to the end of the month. `anchorDay` keeps the intended day of
 * month across short months (Jan 31 → Feb 28 → Mar 31) instead of drifting.
 */
export function addMonths(key: DateKey, months: number, anchorDay?: number): DateKey {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  const targetMonthIndex = m - 1 + months;
  const year = y + Math.floor(targetMonthIndex / 12);
  const monthIndex = ((targetMonthIndex % 12) + 12) % 12;
  const day = Math.min(anchorDay ?? d, daysInMonth(year, monthIndex));
  return keyFromDate(new Date(Date.UTC(year, monthIndex, day)));
}

export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((dateFromKey(a).getTime() - dateFromKey(b).getTime()) / 86_400_000);
}

export function compareKeys(a: DateKey, b: DateKey): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function startOfMonthKey(key: DateKey): DateKey {
  return `${key.slice(0, 7)}-01`;
}

// ── Display ──────────────────────────────────────────────────────────────────

export function formatDateKey(key: DateKey | Date | null | undefined, style: "short" | "long" | "weekday" = "short"): string {
  if (!key) return "—";
  const k = typeof key === "string" ? key : keyFromDate(key);
  const d = dateFromKey(k);
  const opts: Intl.DateTimeFormatOptions =
    style === "long"
      ? { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }
      : style === "weekday"
        ? { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }
        : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

export function formatInstant(
  instant: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIME_ZONE,
  style: "datetime" | "time" | "date" = "datetime",
): string {
  if (!instant) return "—";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const opts: Intl.DateTimeFormatOptions =
    style === "time"
      ? { hour: "numeric", minute: "2-digit", timeZone }
      : style === "date"
        ? { month: "short", day: "numeric", year: "numeric", timeZone }
        : { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone };
  return new Intl.DateTimeFormat("en-US", opts).format(d);
}

export function formatTime24(hhmm: string | null | undefined): string {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, "0")} ${suffix}`;
}

export function formatWindow(start?: string | null, end?: string | null): string {
  if (!start && !end) return "Any time";
  if (start && end) return `${formatTime24(start)} – ${formatTime24(end)}`;
  return start ? `After ${formatTime24(start)}` : `Before ${formatTime24(end)}`;
}

export function relativeDays(key: DateKey, today: DateKey): string {
  const diff = diffDays(key, today);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
