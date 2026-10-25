-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "disposalCostCents" INTEGER,
ADD COLUMN     "disposalGallons" INTEGER,
ADD COLUMN     "disposalRateCents" DECIMAL(10,4);

