-- CreateTable
CREATE TABLE "PersonalizedMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "rationale" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" DATETIME,
    "reviewedAt" DATETIME,
    CONSTRAINT "PersonalizedMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PersonalizedMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "PersonalizedMessage_campaignId_stepKey_idx" ON "PersonalizedMessage"("campaignId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalizedMessage_campaignId_contactId_stepKey_key" ON "PersonalizedMessage"("campaignId", "contactId", "stepKey");
