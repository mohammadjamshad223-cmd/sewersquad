-- CreateEnum
CREATE TYPE "ManifestFeeType" AS ENUM ('NONE', 'STANDARD', 'CITY_OF_HOUSTON', 'WAIVED');

-- CreateEnum
CREATE TYPE "ProposalKind" AS ENUM ('PROPOSAL', 'QUOTE');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "ServiceReportStatus" AS ENUM ('DRAFT', 'FINAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'PROPOSAL';
ALTER TYPE "DocumentType" ADD VALUE 'SERVICE_REPORT';

-- AlterEnum
ALTER TYPE "LineItemKind" ADD VALUE 'MANIFEST_FEE';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "proposalId" UUID,
ADD COLUMN     "serviceReportId" UUID;

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "legacySource" TEXT,
ADD COLUMN     "nextServiceDate" DATE,
ADD COLUMN     "serviceTitle" TEXT;

-- AlterTable
ALTER TABLE "ServiceLocation" ADD COLUMN     "manifestFee" "ManifestFeeType" NOT NULL DEFAULT 'NONE';

-- CreateTable
CREATE TABLE "Proposal" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "kind" "ProposalKind" NOT NULL DEFAULT 'PROPOSAL',
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "organizationId" UUID,
    "locationId" UUID,
    "preparedFor" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'TX',
    "postalCode" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "scopeTitle" TEXT NOT NULL,
    "scopeSubtitle" TEXT,
    "intro" TEXT,
    "note" TEXT,
    "priceNote" TEXT,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "legacySource" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalSection" (
    "id" UUID NOT NULL,
    "proposalId" UUID NOT NULL,
    "title" TEXT,
    "subtotalLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProposalSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalLine" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "kind" "LineItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitPriceCents" DECIMAL(14,4) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProposalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceReport" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ServiceReportStatus" NOT NULL DEFAULT 'DRAFT',
    "organizationId" UUID,
    "locationId" UUID,
    "jobId" UUID,
    "invoiceId" UUID,
    "preparedFor" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'TX',
    "postalCode" TEXT NOT NULL,
    "serviceDate" DATE NOT NULL,
    "subject" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "closing" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "legacySource" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_number_key" ON "Proposal"("number");

-- CreateIndex
CREATE INDEX "Proposal_status_idx" ON "Proposal"("status");

-- CreateIndex
CREATE INDEX "Proposal_organizationId_idx" ON "Proposal"("organizationId");

-- CreateIndex
CREATE INDEX "ProposalSection_proposalId_idx" ON "ProposalSection"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalLine_sectionId_idx" ON "ProposalLine"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ServiceReport_number_key" ON "ServiceReport"("number");

-- CreateIndex
CREATE INDEX "ServiceReport_organizationId_idx" ON "ServiceReport"("organizationId");

-- CreateIndex
CREATE INDEX "ServiceReport_jobId_idx" ON "ServiceReport"("jobId");

-- CreateIndex
CREATE INDEX "Document_proposalId_idx" ON "Document"("proposalId");

-- CreateIndex
CREATE INDEX "Document_serviceReportId_idx" ON "Document"("serviceReportId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_serviceReportId_fkey" FOREIGN KEY ("serviceReportId") REFERENCES "ServiceReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalSection" ADD CONSTRAINT "ProposalSection_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalLine" ADD CONSTRAINT "ProposalLine_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProposalSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReport" ADD CONSTRAINT "ServiceReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReport" ADD CONSTRAINT "ServiceReport_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ServiceLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReport" ADD CONSTRAINT "ServiceReport_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceReport" ADD CONSTRAINT "ServiceReport_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Money and quantities are never negative on proposals (discounts aside).
ALTER TABLE "Proposal" ADD CONSTRAINT proposal_total_nonnegative CHECK ("totalCents" >= 0);

-- Liquid Environmental Solutions disposal site address (from the owner).
UPDATE "DisposalFacility"
SET "addressLine1" = '250 Gellhorn Dr', city = 'Houston', state = 'TX', "postalCode" = '77013',
    notes = replace(notes, 'Invoices show only the payment P.O. box, not the plant address — edit this facility and enter the disposal site address. ', ''),
    "updatedAt" = now()
WHERE name ILIKE '%liquid environmental%' AND "addressLine1" = 'Disposal site address needed';
