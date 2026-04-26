-- AlterTable
ALTER TABLE "ConversionRecord" ADD COLUMN "bookingId" TEXT;

-- CreateIndex
CREATE INDEX "ConversionRecord_bookingId_idx" ON "ConversionRecord"("bookingId");
