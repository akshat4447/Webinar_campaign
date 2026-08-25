-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "linkedinEventError" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "linkedinEventStatus" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "linkedinEventUrn" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "linkedinInvitedAt" DATETIME;
ALTER TABLE "Campaign" ADD COLUMN "linkedinPostUrn" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "linkedinRegFormUrn" TEXT;

-- CreateTable
CREATE TABLE "LinkedinRegistration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT,
    "responseUrn" TEXT NOT NULL,
    "eventUrn" TEXT NOT NULL,
    "organizationUrn" TEXT,
    "formUrn" TEXT,
    "leadAction" TEXT NOT NULL DEFAULT 'CREATED',
    "occurredAt" DATETIME,
    "registrantName" TEXT,
    "registrantEmail" TEXT,
    "contactId" TEXT,
    "processedAt" DATETIME,
    "error" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkedinRegistration_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinRegistration_responseUrn_key" ON "LinkedinRegistration"("responseUrn");

-- CreateIndex
CREATE INDEX "LinkedinRegistration_processedAt_idx" ON "LinkedinRegistration"("processedAt");

-- CreateIndex
CREATE INDEX "LinkedinRegistration_campaignId_idx" ON "LinkedinRegistration"("campaignId");
