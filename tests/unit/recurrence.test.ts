import { describe, expect, it } from "vitest";
import { firstOccurrenceOnOrAfter, nextOccurrence, previewOccurrences, validateRule, type Rule } from "@/domain/recurrence";

describe("recurrence engine", () => {
  const every30: Rule = { unit: "DAY", interval: 30, anchor: "FIXED_CALENDAR", anchorDate: "2026-01-05" };

  it("fixed-calendar: next occurrence ignores late completion", () => {
    // Visit for the 2026-02-04 occurrence was completed 10 days late.
    expect(nextOccurrence(every30, "2026-02-04", "2026-02-14")).toBe("2026-03-06");
  });

  it("fixed-calendar: early completion does not pull the series forward", () => {
    expect(nextOccurrence(every30, "2026-02-04", "2026-01-30")).toBe("2026-03-06");
  });

  it("completion-date: next occurrence is completion + interval", () => {
    const rule: Rule = { ...every30, anchor: "COMPLETION_DATE" };
    expect(nextOccurrence(rule, "2026-02-04", "2026-02-14")).toBe("2026-03-16");
  });

  it("monthly keeps the anchor day across short months", () => {
    const monthly: Rule = { unit: "MONTH", interval: 1, anchor: "FIXED_CALENDAR", anchorDate: "2026-01-31" };
    expect(previewOccurrences(monthly, "2026-01-01", 4)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  });

  it("quarterly from a leap day", () => {
    const q: Rule = { unit: "MONTH", interval: 3, anchor: "FIXED_CALENDAR", anchorDate: "2028-02-29" };
    expect(previewOccurrences(q, "2028-01-01", 3)).toEqual(["2028-02-29", "2028-05-29", "2028-08-29"]);
  });

  it("weekly and biweekly", () => {
    const biweekly: Rule = { unit: "WEEK", interval: 2, anchor: "FIXED_CALENDAR", anchorDate: "2026-03-02" };
    expect(previewOccurrences(biweekly, "2026-03-01", 3)).toEqual(["2026-03-02", "2026-03-16", "2026-03-30"]);
  });

  it("first occurrence on or after a date far after the anchor", () => {
    expect(firstOccurrenceOnOrAfter(every30, "2030-06-01")).toBe("2030-06-13");
    expect(firstOccurrenceOnOrAfter(every30, "2026-01-05")).toBe("2026-01-05");
  });

  it("specific dates", () => {
    const rule: Rule = { unit: "SPECIFIC_DATES", interval: 1, anchor: "FIXED_CALENDAR", anchorDate: "2026-01-01", specificDates: ["2026-07-01", "2026-03-15", "2026-11-20"] };
    expect(firstOccurrenceOnOrAfter(rule, "2026-01-01")).toBe("2026-03-15");
    expect(nextOccurrence(rule, "2026-03-15")).toBe("2026-07-01");
    expect(nextOccurrence(rule, "2026-11-20")).toBeNull();
  });

  it("skipping a cancelled occurrence moves to the following series date", () => {
    expect(nextOccurrence(every30, "2026-01-05")).toBe("2026-02-04");
  });

  it("validates intervals", () => {
    expect(validateRule({ ...every30, interval: 0 })).toMatch(/at least 1/);
    expect(validateRule({ ...every30, unit: "SPECIFIC_DATES", specificDates: [] })).toMatch(/at least one/);
    expect(validateRule(every30)).toBeNull();
  });
});
