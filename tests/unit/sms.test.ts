import { describe, expect, it } from "vitest";
import { toE164 } from "@/lib/phone";
import { smsText } from "@/server/services/notifications";

describe("toE164", () => {
  it("normalizes US numbers as typed", () => {
    expect(toE164("(713) 555-0101")).toBe("+17135550101");
    expect(toE164("713.555.0101")).toBe("+17135550101");
    expect(toE164("1-713-555-0101")).toBe("+17135550101");
    expect(toE164("+1 713 555 0101")).toBe("+17135550101");
    expect(toE164("713-555-0101 x 22")).toBe("+17135550101");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });
  it("rejects numbers it cannot interpret", () => {
    expect(toE164("555-0101")).toBeNull();
    expect(toE164("")).toBeNull();
    expect(toE164(null)).toBeNull();
    expect(toE164("+12")).toBeNull();
  });
});

describe("smsText", () => {
  it("identifies the sender, includes the link and opt-out wording, and stays under the limit", () => {
    const t = smsText("Driver en route.", "Luis is on the way to ABC Restaurant — Katy.", "https://portal.example.com/customer/services/1");
    expect(t).toBe("Sewer Squad: Driver en route. Luis is on the way to ABC Restaurant — Katy. https://portal.example.com/customer/services/1 Reply STOP to opt out.");
    const long = smsText("Update", "x".repeat(2000), "https://p.example.com/a");
    expect(long.length).toBeLessThanOrEqual(600);
    expect(long.endsWith("https://p.example.com/a Reply STOP to opt out.")).toBe(true);
  });
});
