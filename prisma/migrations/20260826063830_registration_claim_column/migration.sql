-- AlterTable
ALTER TABLE "LinkedinRegistration" ADD COLUMN "claimedAt" DATETIME;

-- CreateIndex
CREATE INDEX "LinkedinRegistration_claimedAt_idx" ON "LinkedinRegistration"("claimedAt");
