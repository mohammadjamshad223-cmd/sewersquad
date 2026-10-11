/**
 * Manifest data is grouped by WHO supplied it so the document clearly distinguishes:
 *  generator  – customer account records (Sewer Squad office maintained)
 *  collection – driver-entered field data
 *  hauler     – transporter / hauler certification (company settings + fleet records)
 *  disposal   – disposal facility records (from documented disposal events)
 *  signatures – customer acknowledgment, driver certification, facility acknowledgment
 *  verification – administrator verification
 *  extra      – additional jurisdiction-specific fields defined by the template
 * Nothing is invented: unknown values stay empty and are reported as missing.
 */
export type ManifestData = {
  template: { key: string; name: string; jurisdiction: string } | null;
  reference: { manifestNumber: string; jobNumber: string; serviceDate: string };
  generator: { businessName: string; organizationName: string; accountNumber: string; address: string; locationName: string; county: string | null; contactName: string | null; contactPhone: string | null };
  collection: {
    wasteType: string | null;
    equipment: { assetTag: string; type: string; capacityGallons: number; gallonsPumped: number; servicePerformed: string | null }[];
    totalGallons: number;
    startedAt: string | null;
    finishedAt: string | null;
    notes: string | null;
  };
  hauler: { name: string | null; transporterPermitNumber: string | null; registrationNumber: string | null; driverName: string | null; truckUnit: string | null; vin: string | null; licensePlate: string | null; vehiclePermit: string | null; certificationStatement: string | null };
  disposal: { facilityName: string | null; facilityAddress: string | null; facilityPermit: string | null; disposedAt: string | null; ticketNumber: string | null; facilityAcknowledged: boolean };
  signatures: {
    customer: { name: string | null; title: string | null; signedAt: string | null; unavailable: boolean; unavailableReason: string | null; hasImage: boolean } | null;
    driver: { name: string | null; signedAt: string | null; hasImage: boolean } | null;
  };
  verification: { verifiedBy: string | null; verifiedAt: string | null };
  extra: Record<string, string>;
};

export type TemplateField = { key: string; label: string; section: string; required: boolean; source: "driver" | "customer" | "hauler" | "disposal" | "admin" | "account" };

export const DEFAULT_TEMPLATE_FIELDS: TemplateField[] = [
  { key: "generator.businessName", label: "Generator / business name", section: "Generator", required: true, source: "account" },
  { key: "generator.address", label: "Generator address", section: "Generator", required: true, source: "account" },
  { key: "collection.wasteType", label: "Waste type", section: "Collection", required: true, source: "driver" },
  { key: "collection.totalGallons", label: "Gallons collected", section: "Collection", required: true, source: "driver" },
  { key: "hauler.name", label: "Hauler name", section: "Hauler", required: true, source: "hauler" },
  { key: "hauler.transporterPermitNumber", label: "Transporter permit / license", section: "Hauler", required: false, source: "hauler" },
  { key: "hauler.driverName", label: "Driver name", section: "Hauler", required: true, source: "driver" },
  { key: "hauler.truckUnit", label: "Truck / unit number", section: "Hauler", required: true, source: "hauler" },
  { key: "hauler.vin", label: "Vehicle identification (VIN)", section: "Hauler", required: false, source: "hauler" },
  { key: "disposal.facilityName", label: "Disposal facility", section: "Disposal", required: false, source: "disposal" },
  { key: "disposal.disposedAt", label: "Disposal date / time", section: "Disposal", required: false, source: "disposal" },
  { key: "disposal.ticketNumber", label: "Disposal ticket / reference", section: "Disposal", required: false, source: "disposal" },
  { key: "signatures.customer", label: "Customer acknowledgment", section: "Signatures", required: true, source: "customer" },
  { key: "signatures.driver", label: "Driver certification", section: "Signatures", required: true, source: "driver" },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

/** Required template fields with no value. A customer signature counts when signed OR documented as unavailable. */
export function missingRequiredFields(fields: TemplateField[], data: ManifestData): TemplateField[] {
  return fields.filter((f) => {
    if (!f.required) return false;
    if (f.key === "signatures.customer") {
      const c = data.signatures.customer;
      return !c || (!(c.hasImage && c.name) && !(c.unavailable && c.unavailableReason));
    }
    if (f.key === "signatures.driver") return !data.signatures.driver?.hasImage || !data.signatures.driver.name;
    const v = f.key.startsWith("extra.") ? data.extra[f.key.slice(6)] : getPath(data, f.key);
    return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
  });
}

