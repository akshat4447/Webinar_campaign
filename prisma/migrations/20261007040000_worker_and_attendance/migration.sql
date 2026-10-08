-- AlterTable
ALTER TABLE "CadenceStep" ADD COLUMN     "audience" TEXT NOT NULL DEFAULT 'all';

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "attendanceFingerprint" TEXT,
ADD COLUMN     "attendanceVersion" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "SendQuotaReservation" (
    "key" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'reserved',

    CONSTRAINT "SendQuotaReservation_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "SendQuotaReservation_campaignId_day_idx" ON "SendQuotaReservation"("campaignId", "day");

