import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATE_FIELDS, missingRequiredFields, type ManifestData } from "@/domain/manifest";
import { parseDollarRateToCentsString, parseDollarsToCents } from "@/lib/money";

const base: ManifestData = {
  template: null,
  reference: { manifestNumber: "MF-1", jobNumber: "J-1", serviceDate: "2026-01-01" },
  generator: { businessName: "Biz", organizationName: "Org", accountNumber: "SS-1", address: "1 Main", locationName: "Biz", county: null, contactName: null, contactPhone: null },
  collection: { wasteType: "Grease trap waste", equipment: [], totalGallons: 500, startedAt: null, finishedAt: null, notes: null },
  hauler: { name: "Hauler", transporterPermitNumber: null, registrationNumber: null, driverName: "D", truckUnit: "T-1", vin: null, licensePlate: null, vehiclePermit: null, certificationStatement: null },
  disposal: { facilityName: null, facilityAddress: null, facilityPermit: null, disposedAt: null, ticketNumber: null, facilityAcknowledged: false },
  signatures: { customer: { name: "C", title: null, signedAt: "x", unavailable: false, unavailableReason: null, hasImage: true }, driver: { name: "D", signedAt: "x", hasImage: true } },
  verification: { verifiedBy: null, verifiedAt: null },
  extra: {},
};

describe("manifest required fields", () => {
  it("passes a complete manifest", () => expect(missingRequiredFields(DEFAULT_TEMPLATE_FIELDS, base)).toEqual([]));
  it("accepts a documented unavailable customer instead of a signature", () => {
    const d = { ...base, signatures: { ...base.signatures, customer: { name: null, title: null, signedAt: null, unavailable: true, unavailableReason: "Closed", hasImage: false } } };
    expect(missingRequiredFields(DEFAULT_TEMPLATE_FIELDS, d)).toEqual([]);
  });
  it("flags missing hauler data and unsigned driver; never treats empty as present", () => {
    const d = { ...base, hauler: { ...base.hauler, name: null, truckUnit: "" }, signatures: { ...base.signatures, driver: null } };
    expect(missingRequiredFields(DEFAULT_TEMPLATE_FIELDS, d).map((f) => f.key).sort()).toEqual(["hauler.name", "hauler.truckUnit", "signatures.driver"]);
  });
  it("supports jurisdiction-specific extra fields", () => {
    const fields = [...DEFAULT_TEMPLATE_FIELDS, { key: "extra.cityPermit", label: "City permit", section: "Extra", required: true, source: "admin" as const }];
    expect(missingRequiredFields(fields, base).map((f) => f.key)).toEqual(["extra.cityPermit"]);
    expect(missingRequiredFields(fields, { ...base, extra: { cityPermit: "HOU-1" } })).toEqual([]);
  });
});

describe("money parsing", () => {
  it("parses dollars to integer cents without floats", () => {
    expect(parseDollarsToCents("1,234.5")).toBe(123_450);
    expect(parseDollarsToCents("$0.10")).toBe(10);
    expect(parseDollarsToCents("12.345")).toBeNull();
    expect(parseDollarsToCents("abc")).toBeNull();
  });
  it("parses fractional-cent rates", () => {
    expect(parseDollarRateToCentsString("0.065")).toBe("6.5");
    expect(parseDollarRateToCentsString("0.30")).toBe("30");
    expect(parseDollarRateToCentsString("175")).toBe("17500");
    expect(parseDollarRateToCentsString("-1")).toBeNull();
  });
});
