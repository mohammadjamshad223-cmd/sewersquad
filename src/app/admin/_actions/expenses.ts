"use server";

import { assertStaff } from "@/server/authz/guards";
import { formDataToObject, runAction } from "@/server/action";
import { createExpense, deleteExpense, expenseSchema, setExpenseReimbursed, updateExpense } from "@/server/services/expenses";
import { readUploadedFile } from "@/server/services/documents";
import { isUuid } from "@/server/params";
import { badRequest } from "@/server/errors";

/** Add or edit an external cost; the optional receipt arrives as "receipt". */
export async function saveExpenseAction(fd: FormData) {
  return runAction(async () => {
    const actor = await assertStaff("expenses.write");
    const input = expenseSchema.parse(formDataToObject(fd));
    const receipt = await readUploadedFile(fd.get("receipt"));
    const id = fd.get("expenseId");
    if (id) {
      if (!isUuid(id)) throw badRequest("Invalid cost.");
      await updateExpense(actor, id, input, receipt);
    } else await createExpense(actor, input, receipt);
    return null;
  });
}

export async function deleteExpenseAction(id: string) {
  return runAction(async () => {
    if (!isUuid(id)) throw badRequest("Invalid cost.");
    await deleteExpense(await assertStaff("expenses.write"), id);
    return null;
  });
}

export async function setExpenseReimbursedAction(id: string, reimbursed: boolean) {
  return runAction(async () => {
    if (!isUuid(id)) throw badRequest("Invalid cost.");
    await setExpenseReimbursed(await assertStaff("expenses.write"), id, reimbursed);
    return null;
  });
}
