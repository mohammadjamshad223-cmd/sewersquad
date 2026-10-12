-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsOptInAt" TIMESTAMP(3),
ADD COLUMN     "smsOptInSource" TEXT,
ADD COLUMN     "smsOptedOutAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ContactText" (
    "id" UUID NOT NULL,
    "contactId" UUID NOT NULL,
    "organizationId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactText_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ContactText_status_nextAttemptAt_idx" ON "ContactText"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "ContactText_organizationId_createdAt_idx" ON "ContactText"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ContactText_contactId_dedupeKey_key" ON "ContactText"("contactId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "ContactText" ADD CONSTRAINT "ContactText_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

