-- CreateEnum
CREATE TYPE "DisposalBillStatus" AS ENUM ('OPEN', 'PAID', 'VOID');

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'DISPOSAL_INVOICE';

-- AlterTable
ALTER TABLE "DisposalFacility" ADD COLUMN     "billingPhone" TEXT,
ADD COLUMN     "remitTo" TEXT,
ADD COLUMN     "vendorAccountNumber" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "disposalBillId" UUID;

-- CreateTable
CREATE TABLE "DisposalBill" (
    "id" UUID NOT NULL,
    "facilityId" UUID NOT NULL,
    "vendorInvoiceNumber" TEXT NOT NULL,
    "invoiceDate" DATE NOT NULL,
    "dueDate" DATE,
    "serviceDate" DATE,
    "referenceNumber" TEXT,
    "status" "DisposalBillStatus" NOT NULL DEFAULT 'OPEN',
    "totalCents" INTEGER NOT NULL,
    "scheduledPayDate" DATE,
    "paidAt" DATE,
    "paymentReference" TEXT,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisposalBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisposalBillLine" (
    "id" UUID NOT NULL,
    "billId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "wasteType" TEXT,
    "gallons" INTEGER,
    "ratePerGallonCents" DECIMAL(14,4),
    "amountCents" INTEGER NOT NULL,
    "manifestNumbers" TEXT[],
    "manifestDate" DATE,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DisposalBillLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DisposalBill_invoiceDate_idx" ON "DisposalBill"("invoiceDate");

-- CreateIndex
CREATE INDEX "DisposalBill_status_idx" ON "DisposalBill"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DisposalBill_facilityId_vendorInvoiceNumber_key" ON "DisposalBill"("facilityId", "vendorInvoiceNumber");

-- CreateIndex
CREATE INDEX "DisposalBillLine_billId_idx" ON "DisposalBillLine"("billId");

-- CreateIndex
CREATE INDEX "Document_disposalBillId_idx" ON "Document"("disposalBillId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_disposalBillId_fkey" FOREIGN KEY ("disposalBillId") REFERENCES "DisposalBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisposalBill" ADD CONSTRAINT "DisposalBill_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "DisposalFacility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisposalBillLine" ADD CONSTRAINT "DisposalBillLine_billId_fkey" FOREIGN KEY ("billId") REFERENCES "DisposalBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Money and quantities are never negative (matches the guards on customer invoices).
ALTER TABLE "DisposalBill" ADD CONSTRAINT disposal_bill_total_nonnegative CHECK ("totalCents" >= 0);
ALTER TABLE "DisposalBillLine" ADD CONSTRAINT disposal_bill_line_nonnegative CHECK ("amountCents" >= 0 AND ("gallons" IS NULL OR "gallons" >= 0));
