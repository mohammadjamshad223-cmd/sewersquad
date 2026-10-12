import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, expectCode, PNG } from "./helpers";
import { createDisposalBill, disposalBillSummary, setDisposalBillStatus, billSchema } from "@/server/services/disposal-bills";
import { authorizeDocument } from "@/server/services/documents";

const IMPORT_SQL = readFileSync("prisma/migrations/20261012011000_import_disposal_bills_2026_06_08/migration.sql", "utf8");
const SOUTHWASTE_SQL = readFileSync("prisma/migrations/20261012020000_import_southwaste_bills/migration.sql", "utf8");

describe("disposal vendor bills", () => {
  let facilityId: string;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    facilityId = (await prisma.disposalFacility.create({ data: { name: "Test Grease Plant", addressLine1: "1 Plant Rd", city: "Houston", state: "TX", postalCode: "77001" } })).id;
  });

  const input = (n: string, lines: object[]) => billSchema.parse({ facilityId, vendorInvoiceNumber: n, invoiceDate: "2026-07-10", lines: JSON.stringify(lines) });

  it("computes line amounts from gallons × rate, stores the PDF, and rejects duplicates", async () => {
    const admin = await staff("admin");
    const bill = await createDisposalBill(admin, input("INV-1", [
      { description: "Grease", gallons: "2,000", rate: "0.185", manifests: "194401, 194402" },
      { description: "Fuel surcharge", amount: "12.50" },
    ]), { bytes: PNG, name: "inv.png" });
    expect(bill.totalCents).toBe(37_000 + 1_250);
    const lines = await prisma.disposalBillLine.findMany({ where: { billId: bill.id }, orderBy: { sortOrder: "asc" } });
    expect(lines.map((l) => l.amountCents)).toEqual([37_000, 1_250]);
    expect(lines[0]!.manifestNumbers).toEqual(["194401", "194402"]);
    const doc = await prisma.document.findFirstOrThrow({ where: { disposalBillId: bill.id } });
    expect(doc.type).toBe("DISPOSAL_INVOICE");
    expect(doc.visibility).toBe("INTERNAL");
    await authorizeDocument(admin, doc.id);
    await expectCode(createDisposalBill(admin, input("INV-1", [{ description: "x", amount: "1" }]), null), "CONFLICT");
    await expectCode(createDisposalBill(admin, input("INV-2", [{ description: "x", gallons: "10" }]), null), "BAD_REQUEST");
  });

  it("only staff with disposal.write can add or pay bills", async () => {
    const accounting = await staff("accounting");
    await expectCode(createDisposalBill(accounting, input("INV-3", [{ description: "x", amount: "1" }]), null), "FORBIDDEN");
  });

  it("tracks paid, open and void in the summary", async () => {
    const admin = await staff("admin");
    const b = await createDisposalBill(admin, input("INV-4", [{ description: "Grit", gallons: "800", rate: "0.29" }]), null);
    const dup = await createDisposalBill(admin, input("INV-5", [{ description: "Dup", amount: "100" }]), null);
    await setDisposalBillStatus(admin, { billId: b.id, status: "PAID", paidAt: "2026-07-20", paymentReference: "Check 1001" });
    await setDisposalBillStatus(admin, { billId: dup.id, status: "VOID", reason: "Entered twice" });
    await expectCode(setDisposalBillStatus(admin, { billId: dup.id, status: "OPEN" }), "BAD_REQUEST");
    const s = await disposalBillSummary({ from: "2026-07-01", to: "2026-07-31" });
    expect(s.billedCents).toBe(38_250 + 23_200);
    expect(s.paidCents).toBe(23_200);
    expect(s.openCents).toBe(38_250);
    expect(s.gallons).toBe(2_800);
    expect(s.byVendor).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityType: "DisposalBill", entityId: b.id } })).toBe(2);
  });

  it("the invoice import migration loads the vendor bills once and is safe to re-run", async () => {
    await prisma.$executeRawUnsafe(IMPORT_SQL);
    await prisma.$executeRawUnsafe(IMPORT_SQL);
    const imported = await prisma.disposalBill.findMany({ where: { facility: { name: { in: ["Liquid Environmental Solutions", "DownStream Environmental"] } } }, include: { lines: true } });
    expect(imported).toHaveLength(9);
    expect(imported.reduce((s, b) => s + b.totalCents, 0)).toBe(270_075);
    for (const b of imported) expect(b.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(b.totalCents);
    expect(await prisma.disposalFacility.count({ where: { name: "DownStream Environmental" } })).toBe(1);
  });

  it("the Southwaste import matches the vendor statement (16 invoices, $3,562.35)", async () => {
    await prisma.$executeRawUnsafe(SOUTHWASTE_SQL);
    await prisma.$executeRawUnsafe(SOUTHWASTE_SQL);
    const sw = await prisma.disposalBill.findMany({ where: { facility: { name: "Southwaste Disposal" } }, include: { lines: true } });
    expect(sw).toHaveLength(16);
    expect(sw.reduce((s, b) => s + b.totalCents, 0)).toBe(356_235);
    for (const b of sw) expect(b.lines.reduce((s, l) => s + l.amountCents, 0)).toBe(b.totalCents);
    const withGallons = sw.flatMap((b) => b.lines).filter((l) => l.gallons !== null);
    expect(withGallons.reduce((s, l) => s + l.gallons!, 0)).toBe(9_905);
    expect(withGallons.every((l) => l.amountCents === l.gallons! * 17)).toBe(true);
  });
});
