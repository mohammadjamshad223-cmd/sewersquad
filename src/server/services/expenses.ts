import "server-only";
import { z } from "zod";
import type { ExpenseCategory, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit } from "../audit";
import { badRequest, notFound } from "../errors";
import type { Actor } from "../auth/session";
import { assertStaffActor } from "../authz/check";
import { dateFromKey, isDateKey } from "@/lib/dates";
import { parseDollarsToCents } from "@/lib/money";
import { storeDocument } from "./documents";

/**
 * External costs: money spent outside disposal-site bills (gas, contractors on plumbing jobs,
 * tools, permits…), so profit reflects what the business actually spends. Each cost records where
 * the money came from; personal money stays "owed back" until it's marked reimbursed.
 */
export const EXPENSE_CATEGORY_LABEL: Record<ExpenseCategory, string> = {
  FUEL: "Gas / fuel",
  CONTRACTOR: "Contractor payment",
  TOOLS_EQUIPMENT: "Tools & equipment",
  PERMITS_LICENSES: "Permits & licenses",
  TRUCK_MAINTENANCE: "Truck repairs & maintenance",
  INSURANCE: "Insurance",
  SUPPLIES: "Supplies",
  MARKETING: "Marketing & ads",
  OFFICE_SOFTWARE: "Office & software",
  OTHER: "Other",
};

export const PAID_FROM_LABEL = { BUSINESS_ACCOUNT: "Business bank account", BUSINESS_CARD: "Business card", CASH: "Cash", PERSONAL: "Personal (someone's own money)" } as const;

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => (v ? v : null));

export const expenseSchema = z
  .object({
    date: z.string().refine(isDateKey, "Pick the date."),
    category: z.enum(Object.keys(EXPENSE_CATEGORY_LABEL) as [ExpenseCategory, ...ExpenseCategory[]]),
    amount: z.string().trim().refine((v) => (parseDollarsToCents(v) ?? 0) > 0, "Enter the amount, e.g. 64.25"),
    vendor: optional(200),
    description: z.string().trim().min(2, "Say what it was for.").max(500),
    paidFrom: z.enum(["BUSINESS_ACCOUNT", "BUSINESS_CARD", "CASH", "PERSONAL"]).default("BUSINESS_ACCOUNT"),
    paidByUserId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    paidByName: optional(120),
    organizationId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
    notes: optional(2000),
  })
  .superRefine((v, ctx) => {
    if (v.paidFrom === "PERSONAL" && !v.paidByUserId && !v.paidByName) ctx.addIssue({ code: "custom", path: ["paidByUserId"], message: "Who paid for it?" });
  });
export type ExpenseInput = z.infer<typeof expenseSchema>;

async function resolvePayer(input: ExpenseInput) {
  if (input.paidFrom !== "PERSONAL") return { paidByUserId: null, paidByName: null };
  if (input.paidByUserId) {
    const u = await prisma.user.findFirst({ where: { id: input.paidByUserId, kind: "STAFF" }, select: { id: true, name: true } });
    if (!u) throw badRequest("Pick who paid from the list.");
    return { paidByUserId: u.id, paidByName: u.name };
  }
  return { paidByUserId: null, paidByName: input.paidByName };
}

function fields(input: ExpenseInput) {
  return {
    date: dateFromKey(input.date),
    category: input.category,
    amountCents: parseDollarsToCents(input.amount)!,
    vendor: input.vendor,
    description: input.description,
    paidFrom: input.paidFrom,
    organizationId: input.organizationId ?? null,
    notes: input.notes,
  };
}

export async function createExpense(actor: Actor, input: ExpenseInput, receipt: { bytes: Uint8Array; name: string } | null) {
  assertStaffActor(actor, "expenses.write");
  const payer = await resolvePayer(input);
  return prisma.$transaction(async (tx) => {
    const e = await tx.expense.create({ data: { ...fields(input), ...payer, createdById: actor.userId } });
    if (receipt) await storeDocument(tx, { bytes: receipt.bytes, fileName: receipt.name, title: `Receipt — ${input.vendor ?? EXPENSE_CATEGORY_LABEL[input.category]}`, type: "RECEIPT", organizationId: null, expenseId: e.id, uploadedById: actor.userId });
    await audit(tx, { actorId: actor.userId, action: "expense.create", entityType: "Expense", entityId: e.id, after: { ...input, receipt: !!receipt } });
    return e;
  });
}

export async function updateExpense(actor: Actor, id: string, input: ExpenseInput, receipt: { bytes: Uint8Array; name: string } | null) {
  assertStaffActor(actor, "expenses.write");
  const before = await prisma.expense.findFirst({ where: { id, deletedAt: null } });
  if (!before) throw notFound();
  const payer = await resolvePayer(input);
  return prisma.$transaction(async (tx) => {
    const e = await tx.expense.update({ where: { id }, data: { ...fields(input), ...payer, ...(input.paidFrom !== "PERSONAL" ? { reimbursedAt: null } : {}) } });
    if (receipt) await storeDocument(tx, { bytes: receipt.bytes, fileName: receipt.name, title: `Receipt — ${input.vendor ?? EXPENSE_CATEGORY_LABEL[input.category]}`, type: "RECEIPT", expenseId: id, uploadedById: actor.userId });
    await audit(tx, { actorId: actor.userId, action: "expense.update", entityType: "Expense", entityId: id, before, after: { ...input, receipt: !!receipt } });
    return e;
  });
}

export async function deleteExpense(actor: Actor, id: string) {
  assertStaffActor(actor, "expenses.write");
  const e = await prisma.expense.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound();
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { deletedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "expense.delete", entityType: "Expense", entityId: id, before: e });
  });
}

/** Mark money someone paid personally as paid back to them (or undo it). */
export async function setExpenseReimbursed(actor: Actor, id: string, reimbursed: boolean) {
  assertStaffActor(actor, "expenses.write");
  const e = await prisma.expense.findFirst({ where: { id, deletedAt: null } });
  if (!e) throw notFound();
  if (e.paidFrom !== "PERSONAL") throw badRequest("Only costs paid from someone's own money are reimbursed.");
  await prisma.$transaction(async (tx) => {
    await tx.expense.update({ where: { id }, data: { reimbursedAt: reimbursed ? new Date() : null } });
    await audit(tx, { actorId: actor.userId, action: reimbursed ? "expense.reimbursed" : "expense.reimbursement_undone", entityType: "Expense", entityId: id, after: { amountCents: e.amountCents, paidByName: e.paidByName } });
  });
}

export function expenseWhere(f: { from?: string; to?: string; category?: string }): Prisma.ExpenseWhereInput {
  return {
    deletedAt: null,
    ...(f.category && f.category in EXPENSE_CATEGORY_LABEL ? { category: f.category as ExpenseCategory } : {}),
    ...(f.from || f.to ? { date: { ...(f.from && isDateKey(f.from) ? { gte: dateFromKey(f.from) } : {}), ...(f.to && isDateKey(f.to) ? { lte: dateFromKey(f.to) } : {}) } } : {}),
  };
}

/** Totals for a period by category and by where the money came from, plus what's still owed back to people. */
export async function expenseSummary(f: { from?: string; to?: string; category?: string }) {
  const where = expenseWhere(f);
  const [byCategory, byPaidFrom, owed] = await Promise.all([
    prisma.expense.groupBy({ by: ["category"], where, _sum: { amountCents: true }, _count: true }),
    prisma.expense.groupBy({ by: ["paidFrom"], where, _sum: { amountCents: true } }),
    // Owed back is all-time, not just this period.
    prisma.expense.groupBy({ by: ["paidByName"], where: { deletedAt: null, paidFrom: "PERSONAL", reimbursedAt: null }, _sum: { amountCents: true }, _count: true }),
  ]);
  return {
    totalCents: byCategory.reduce((s, c) => s + (c._sum.amountCents ?? 0), 0),
    count: byCategory.reduce((s, c) => s + c._count, 0),
    byCategory: byCategory.map((c) => ({ category: c.category, label: EXPENSE_CATEGORY_LABEL[c.category], cents: c._sum.amountCents ?? 0, count: c._count })).sort((a, b) => b.cents - a.cents),
    byPaidFrom: byPaidFrom.map((p) => ({ paidFrom: p.paidFrom, label: PAID_FROM_LABEL[p.paidFrom], cents: p._sum.amountCents ?? 0 })),
    owed: owed.map((o) => ({ name: o.paidByName ?? "Someone", cents: o._sum.amountCents ?? 0, count: o._count })).sort((a, b) => b.cents - a.cents),
  };
}
