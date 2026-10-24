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
