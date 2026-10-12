import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prisma } from "./helpers";
import { drawManifest, wasteSources } from "@/server/pdf/manifest-pdf";
import type { ManifestData } from "@/server/services/manifests";

const data: ManifestData = {
  template: null,
  reference: { manifestNumber: "194439", jobNumber: "J-2026-000001", serviceDate: "2026-10-12" },
  generator: { businessName: "Ghost Bar", organizationName: "Ghost Bar", accountNumber: "SS-10001", address: "5600 Richmond Ave, Houston, TX 77057", locationName: "Ghost Bar", county: "Harris", contactName: "Manager", contactPhone: "713-555-0100", postalCode: "77057", cityCounty: "Houston / Harris" },
  collection: { wasteType: "Grease trap waste", equipment: [{ assetTag: "AS-000001", type: "Grease Trap", capacityGallons: 1000, gallonsPumped: 1000, servicePerformed: "Pumped" }], totalGallons: 1000, startedAt: "2026-10-12T14:00:00Z", finishedAt: "2026-10-12T14:40:00Z", notes: null },
  hauler: { name: "Sewer Squad Services LLC", transporterPermitNumber: null, registrationNumber: null, driverName: "Sam Rivera", truckUnit: "T-1", vin: null, licensePlate: null, vehiclePermit: null, certificationStatement: null, tceqNumber: "26967", address: "5718 Westheimer Rd, Houston, TX", phone: "346-244-5579" },
  disposal: { facilityName: "Hurst (Southwaste)", facilityAddress: "16290 Katy Frwy, Suite 250, Houston, TX 77094", facilityPermit: null, disposedAt: "2026-10-12T17:00:00Z", ticketNumber: "1022857", facilityAcknowledged: true, gallonsReceived: 1200 },
  signatures: { customer: null, driver: null },
  verification: { verifiedBy: null, verifiedAt: null },
  extra: {},
};

describe("manifest PDF in the owner's form", () => {
  it("ticks the right waste source boxes", () => {
    const s = wasteSources([{ type: "Grease Trap" }, { type: "Grease Interceptor" }, { type: "Grit Trap" }, { type: "Lint Trap" }]);
    expect([...s.checked].sort()).toEqual(["Grease Trap", "Grit Trap"]);
    expect(s.other).toBe("Lint Trap");
  });
  it("renders a one-page manifest", async () => {
    const bytes = await drawManifest(prisma, { data, customerSignature: { name: "J. Smith", at: "2026-10-12T14:41:00Z", imageKey: null }, driverSignature: { name: "Sam Rivera", at: "2026-10-12T14:42:00Z", imageKey: null }, draft: false, integrity: "Manifest 194439 · v1" });
    expect(Buffer.from(bytes).subarray(0, 5).toString()).toBe("%PDF-");
    if (process.env.PDF_OUT) writeFileSync(`${process.env.PDF_OUT}/manifest.pdf`, bytes);
  });
});
