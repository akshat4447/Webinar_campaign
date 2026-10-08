-- Normalize existing addresses before enforcing campaign identity. Multiple NULL emails remain valid.
UPDATE "Contact" SET "email" = NULLIF(lower(btrim("email")), '') WHERE "email" IS NOT NULL;
-- AlterTable
ALTER TABLE "CadenceSend" ADD COLUMN IF NOT EXISTS "deliveryOutcome" TEXT,
ADD COLUMN IF NOT EXISTS "providerMessageId" TEXT,
ADD COLUMN IF NOT EXISTS "recipient" TEXT,
ADD COLUMN IF NOT EXISTS "renderedBody" TEXT,
ADD COLUMN IF NOT EXISTS "renderedSubject" TEXT,
ADD COLUMN IF NOT EXISTS "templateVersion" TEXT;

-- AlterTable
ALTER TABLE "Campaign" DROP COLUMN IF EXISTS "simulatedNow",
ADD COLUMN IF NOT EXISTS "launchedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "lsqExclusionListIds" TEXT,
ADD COLUMN IF NOT EXISTS "lsqSuppressionListId" TEXT,
ADD COLUMN IF NOT EXISTS "selectedChannels" TEXT DEFAULT 'email_campaign,whatsapp,linkedin,sdr_sales,third_parties,linkedin_event,website';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "zoomJoinUrl" TEXT,
ADD COLUMN IF NOT EXISTS "zoomRegistrantId" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "RegistrationJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DeliveryAttempt" (
    "key" TEXT NOT NULL,
    "campaignId" TEXT,
    "sendId" TEXT,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dispatching',
    "payloadJson" TEXT,
    "receiptJson" TEXT,
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "DailySendBudget" (
    "campaignId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DailySendBudget_pkey" PRIMARY KEY ("campaignId","day")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WorkerLease" (
    "name" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerLease_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "OperationJob" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payloadJson" TEXT NOT NULL,
    "resultJson" TEXT NOT NULL DEFAULT '{}',
    "cursor" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "claimedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CampaignSuppression" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'manual',
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RegistrationJob_status_nextAttemptAt_idx" ON "RegistrationJob"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RegistrationJob_campaignId_status_idx" ON "RegistrationJob"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "RegistrationJob_contactId_kind_key" ON "RegistrationJob"("contactId", "kind");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "DeliveryAttempt_campaignId_status_startedAt_idx" ON "DeliveryAttempt"("campaignId", "status", "startedAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OperationJob_status_createdAt_idx" ON "OperationJob"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OperationJob_campaignId_createdAt_idx" ON "OperationJob"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignSuppression_campaignId_idx" ON "CampaignSuppression"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignSuppression_campaignId_email_idx" ON "CampaignSuppression"("campaignId", "email");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "CampaignSuppression_email_idx" ON "CampaignSuppression"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignSuppression_campaignId_email_key" ON "CampaignSuppression"("campaignId", "email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Contact_campaignId_email_key" ON "Contact"("campaignId", "email");

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RegistrationJob_contactId_fkey') THEN ALTER TABLE "RegistrationJob" ADD CONSTRAINT "RegistrationJob_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;

-- AddForeignKey
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignSuppression_campaignId_fkey') THEN ALTER TABLE "CampaignSuppression" ADD CONSTRAINT "CampaignSuppression_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE; END IF; END $$;


CREATE OR REPLACE FUNCTION normalize_contact_email() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  NEW."email" := NULLIF(lower(btrim(NEW."email")), ''); RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS contact_email_normalization ON "Contact";
CREATE TRIGGER contact_email_normalization BEFORE INSERT OR UPDATE OF "email" ON "Contact" FOR EACH ROW EXECUTE FUNCTION normalize_contact_email();
UPDATE "Campaign" c SET "launchedAt" = COALESCE((SELECT min(s."createdAt") FROM "CadenceSend" s WHERE s."campaignId" = c."id"), c."createdAt") WHERE c."cadenceStatus" <> 'not_started' AND c."launchedAt" IS NULL;
DELETE FROM "AppSetting" WHERE "key" IN ('send_mode','integration.zoom.mode','integration.linkedin.mode');
