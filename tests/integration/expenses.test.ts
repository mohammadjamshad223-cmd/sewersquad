import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDb, seedRbac, staff, org, sentInvoice, PNG, expectCode, today } from "./helpers";
import { createExpense, deleteExpense, expenseSchema, expenseSummary, setExpenseReimbursed, updateExpense } from "@/server/services/expenses";
import { grossProfitByMonth } from "@/server/services/analytics";
import { addMonths, startOfMonthKey, dateFromKey } from "@/lib/dates";

describe("external costs", () => {
  let owner: Awaited<ReturnType<typeof staff>>;
  beforeAll(async () => {
    await resetDb();
    await seedRbac();
    owner = await staff("super_admin");
  });

  it("records costs with where the money came from and tracks what's owed back", async () => {
    const A = await org("Willies", { locations: 1 });
    const gas = await createExpense(owner, expenseSchema.parse({ date: today(), category: "FUEL", amount: "64.25", vendor: "Buc-ee's", description: "Diesel", paidFrom: "BUSINESS_CARD" }), null);
    const plumber = await createExpense(owner, expenseSchema.parse({ date: today(), category: "CONTRACTOR", amount: "350", vendor: "Joe's Plumbing", description: "Plumber for Willies job", paidFrom: "PERSONAL", paidByUserId: owner.userId, organizationId: A.org.id }), { bytes: PNG, name: "receipt.png" });
    expect(plumber.paidByName).toBe(owner.name);
    expect(await prisma.document.count({ where: { expenseId: plumber.id, type: "RECEIPT" } })).toBe(1);

    const month = { from: startOfMonthKey(today()), to: addMonths(startOfMonthKey(today()), 1) };
    let s = await expenseSummary(month);
    expect(s.totalCents).toBe(41425);
    expect(s.byCategory.map((c) => [c.category, c.cents])).toEqual([["CONTRACTOR", 35000], ["FUEL", 6425]]);
    expect(s.owed).toEqual([{ name: owner.name, cents: 35000, count: 1 }]);

    await setExpenseReimbursed(owner, plumber.id, true);
    expect((await expenseSummary(month)).owed).toEqual([]);
    await expectCode(setExpenseReimbursed(owner, gas.id, true), "BAD_REQUEST"); // business card isn't paid back

    // Personal needs a person; editing to the business account clears reimbursement.
    expect(() => expenseSchema.parse({ date: today(), category: "TOOLS_EQUIPMENT", amount: "20", description: "Hose", paidFrom: "PERSONAL" })).toThrow(/Who paid/);
    await updateExpense(owner, plumber.id, expenseSchema.parse({ date: today(), category: "CONTRACTOR", amount: "300", description: "Plumber for Willies job", paidFrom: "BUSINESS_ACCOUNT" }), null);
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: plumber.id } })).reimbursedAt).toBeNull();

    await deleteExpense(owner, gas.id);
    s = await expenseSummary(month);
    expect(s.totalCents).toBe(30000);
    await expectCode(createExpense(await staff("dispatcher"), expenseSchema.parse({ date: today(), category: "FUEL", amount: "5", description: "Gas" }), null), "FORBIDDEN");
  });

  it("other costs come off the month's profit on the dashboard", async () => {
    const B = await org("Profit Co", { locations: 1 });
    const inv = await sentInvoice(B.org.id, B.locations[0]!.id, 100000);
    await prisma.invoice.update({ where: { id: inv.id }, data: { issueDate: dateFromKey(today()), subtotalCents: 100000 } });
    const p = await grossProfitByMonth(1);
    const m = p.months[0]!;
    expect(m.otherCostsCents).toBe(30000); // the $300 contractor from the first test
    expect(m.profitCents).toBe(m.grossCents - 30000);
  });
});

describe("disposal cost per job", () => {
  it("uses the cost entered on the invoice, 0 for waste water, and never charges dumping on hydro jetting", async () => {
    const { createInvoice, invoiceSchema, sendInvoice, setInvoiceDisposalCost } = await import("@/server/services/invoices");
    const { haulsWaste } = await import("@/domain/disposal-cost");
    const owner = await staff("super_admin");
    const C = await org("Disposal Co", { locations: 1 });
    const facility = await prisma.disposalFacility.create({ data: { name: "LES", addressLine1: "250 Gellhorn Dr", city: "Houston", state: "TX", postalCode: "77013" } });
    await prisma.disposalBill.create({ data: { facilityId: facility.id, vendorInvoiceNumber: "B1", invoiceDate: new Date(), totalCents: 20000, lines: { create: { description: "Grease", gallons: 1000, amountCents: 20000 } } } }); // 20¢/gal average
    const before = (await grossProfitByMonth(1)).months[0]!;
    const make = async (title: string, gallons: string, disposalCentsPerGallon?: string) => {
      const inv = await createInvoice(owner, invoiceSchema.parse({ organizationId: C.org.id, serviceLocationId: C.locations[0]!.id, serviceTitle: title, disposalCentsPerGallon, lines: [{ kind: "PER_GALLON", description: title, quantity: gallons, unitPrice: "0.89" }] }));
      await sendInvoice(owner, inv.id);
      return inv;
    };
    const entered = await make("Grease Trap Pumping & Disposal", "500", "15"); // 500 × 15¢ = $75
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: entered.id } })).disposalCostCents).toBe(7500);
    const water = await make("Grease Trap Pumping & Disposal", "300", "0"); // waste water: $0
    await make("Hydro Jetting", "400"); // jetting: never charged, even with gallons
    const avg = await make("Grit Trap Pumping & Disposal", "100"); // not entered: average 20¢ → $20
    const after = (await grossProfitByMonth(1)).months[0]!;
    expect(after.disposalCents - before.disposalCents).toBe(7500 + 0 + 2000);
    expect(after.gallons - before.gallons).toBe(900); // jetting gallons aren't "hauled"

    // Changing it later from the invoice page updates profit.
    await setInvoiceDisposalCost(owner, avg.id, "0");
    await setInvoiceDisposalCost(owner, water.id, "18.5"); // 300 × 18.5¢ = $55.50
    expect((await grossProfitByMonth(1)).months[0]!.disposalCents - before.disposalCents).toBe(7500 + 5550);
    await expectCode(setInvoiceDisposalCost(owner, avg.id, "abc"), "BAD_REQUEST");
    expect([haulsWaste("HYDRO_JETTING"), haulsWaste("LINE_CLEANING"), haulsWaste("GREASE_TRAP_PUMPING"), haulsWaste(null, "Line Snaking, Jetting & Inspection"), haulsWaste(null, "Grease Trap & Sanitary Line Waste")]).toEqual([false, false, true, false, true]);
  });
});

describe("profit page", () => {
  it("lists each job's dumping fee and matches the dashboard totals", async () => {
    const { monthProfitDetail } = await import("@/server/services/analytics");
    const d = await monthProfitDetail(today());
    const m = (await grossProfitByMonth(1)).months[0]!;
    expect([d.revenueCents, d.disposalCents, d.otherCostsCents, d.profitCents]).toEqual([m.revenueCents, m.disposalCents, m.otherCostsCents, m.profitCents]);
    const jetting = d.jobs.find((j) => j.service === "Hydro Jetting")!;
    expect([jetting.source, jetting.disposalCents, jetting.gallons]).toEqual(["none", 0, 0]);
    expect(d.jobs.filter((j) => j.source === "average").length).toBe(d.usingAverage);
  });
});
