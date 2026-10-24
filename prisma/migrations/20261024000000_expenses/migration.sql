-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('FUEL', 'CONTRACTOR', 'TOOLS_EQUIPMENT', 'PERMITS_LICENSES', 'TRUCK_MAINTENANCE', 'INSURANCE', 'SUPPLIES', 'MARKETING', 'OFFICE_SOFTWARE', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpensePaidFrom" AS ENUM ('BUSINESS_ACCOUNT', 'BUSINESS_CARD', 'CASH', 'PERSONAL');

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "expenseId" UUID;

-- CreateTable
CREATE TABLE "Expense" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "vendor" TEXT,
    "description" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "paidFrom" "ExpensePaidFrom" NOT NULL DEFAULT 'BUSINESS_ACCOUNT',
    "paidByName" TEXT,
    "paidByUserId" UUID,
    "reimbursedAt" TIMESTAMP(3),
    "organizationId" UUID,
    "jobId" UUID,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Expense_date_idx" ON "Expense"("date");

-- CreateIndex
CREATE INDEX "Expense_category_date_idx" ON "Expense"("category", "date");

-- CreateIndex
CREATE INDEX "Expense_organizationId_idx" ON "Expense"("organizationId");

-- CreateIndex
CREATE INDEX "Expense_paidFrom_reimbursedAt_idx" ON "Expense"("paidFrom", "reimbursedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Permissions for the External Costs page: owners/admins and accounting.
INSERT INTO "Permission" ("id", "key", "description", "group") VALUES
  (gen_random_uuid(), 'expenses.read', 'View external costs (gas, contractors, tools, permits)', 'Billing'),
  (gen_random_uuid(), 'expenses.write', 'Record and edit external costs', 'Billing')
ON CONFLICT ("key") DO NOTHING;
INSERT INTO "RolePermission" ("id", "roleId", "permissionId")
SELECT gen_random_uuid(), r."id", p."id" FROM "Role" r CROSS JOIN "Permission" p
WHERE r."key" IN ('super_admin', 'admin', 'accounting') AND p."key" IN ('expenses.read', 'expenses.write')
ON CONFLICT ("roleId", "permissionId") DO NOTHING;
