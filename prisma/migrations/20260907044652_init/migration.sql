-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'draft',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "zoomLink" TEXT,
    "registrationLink" TEXT,
    "invites" INTEGER,
    "registrations" INTEGER,
    "attendance" TEXT,
    "demoRequests" INTEGER,
    "frequency" TEXT NOT NULL DEFAULT 'balanced',
    "scheduleWindow" TEXT NOT NULL DEFAULT '9:00 AM – 6:00 PM IST',
    "dailyLimit" INTEGER NOT NULL DEFAULT 500,
    "scoringPrompt" TEXT NOT NULL DEFAULT 'Score each contact 0–100 on how relevant they are to this webinar''s topic, weighting title seniority, functional fit, and account vertical match.',
    "scoringCriteria" TEXT NOT NULL DEFAULT 'VP/Director+ in Marketing, Ops, or Admissions; account vertical matches webinar topic; verified email available.',
    "scoringThreshold" INTEGER NOT NULL DEFAULT 70,
    "personalizationPrompt" TEXT NOT NULL DEFAULT 'Lead with the operational problem their role actually owns — don''t open by praising the company or telling the reader how impressive their work is. Vary the angle by seniority: executives care about outcome and risk, directors and heads about process and their team''s throughput, managers and individual contributors about the day-to-day mechanics. Vary by function too — a marketing lead and an operations lead should not receive the same framing.',
    "speakerName" TEXT,
    "speakerTitle" TEXT,
    "capacity" INTEGER,
    "msgMode" TEXT NOT NULL DEFAULT 'ai',
    "tone" TEXT,
    "msgLength" TEXT,
    "aiInstructions" TEXT,
    "brief" TEXT,
    "oneClickSignup" BOOLEAN NOT NULL DEFAULT true,
    "zoomMode" TEXT,
    "zoomMeetingId" TEXT,
    "cadenceStatus" TEXT NOT NULL DEFAULT 'not_started',
    "linkedinMode" TEXT NOT NULL DEFAULT 'assisted',
    "simulatedNow" TIMESTAMP(3),
    "attendanceImportedAt" TIMESTAMP(3),
    "lsqListId" TEXT,
    "linkedinEventUrn" TEXT,
    "linkedinPostUrn" TEXT,
    "linkedinRegFormUrn" TEXT,
    "linkedinEventStatus" TEXT,
    "linkedinEventError" TEXT,
    "linkedinInvitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "account" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "function" TEXT NOT NULL,
    "seniority" TEXT NOT NULL,
    "linkedinId" TEXT,
    "missingInfo" BOOLEAN NOT NULL DEFAULT false,
    "phone" TEXT,
    "smsOptOut" BOOLEAN NOT NULL DEFAULT false,
    "whatsappOptIn" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "explanation" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Apollo',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedManually" BOOLEAN NOT NULL DEFAULT false,
    "lsqLeadId" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "enrichmentSource" TEXT,
    "personaNote" TEXT,
    "extraFieldsJson" TEXT,
    "emailSimulated" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "registeredAt" TIMESTAMP(3),
    "registrationSource" TEXT,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "watchMinutes" INTEGER,
    "linkedinCheckStatus" TEXT,
    "linkedinCheckedAt" TIMESTAMP(3),
    "linkedinCheckNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PersonalizedMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "rationale" TEXT,
    "linkUsed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "PersonalizedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "hasSubject" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "savedSubject" TEXT,
    "savedBody" TEXT,
    "savedAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "channel" TEXT NOT NULL,
    "key" TEXT,
    "name" TEXT NOT NULL,
    "hasSubject" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "language" TEXT,
    "footer" TEXT,
    "buttons" TEXT,
    "dltTemplateId" TEXT,
    "senderId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ready',
    "savedSubject" TEXT,
    "savedBody" TEXT,
    "savedAt" TIMESTAMP(3),
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadenceStep" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "timing" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "desc" TEXT NOT NULL,
    "toggleable" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "isRoadmap" BOOLEAN NOT NULL DEFAULT false,
    "trigger" TEXT NOT NULL DEFAULT 'launch',
    "templateId" TEXT,
    "createdByUser" BOOLEAN NOT NULL DEFAULT false,
    "removedAt" TIMESTAMP(3),
    "offsetValue" INTEGER NOT NULL DEFAULT 0,
    "offsetUnit" TEXT NOT NULL DEFAULT 'days',
    "anchor" TEXT NOT NULL DEFAULT 'launch',

    CONSTRAINT "CadenceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CadenceSend" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "stepKey" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CadenceSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityLogEntry" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "dot" TEXT NOT NULL DEFAULT 'var(--accent-500)',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLogEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttentionItem" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "actionsCsv" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttentionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "from" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkedinRegistration" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT,
    "responseUrn" TEXT NOT NULL,
    "eventUrn" TEXT NOT NULL,
    "organizationUrn" TEXT,
    "formUrn" TEXT,
    "leadAction" TEXT NOT NULL DEFAULT 'CREATED',
    "occurredAt" TIMESTAMP(3),
    "registrantName" TEXT,
    "registrantEmail" TEXT,
    "contactId" TEXT,
    "processedAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkedinRegistration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_campaignId_approved_idx" ON "Contact"("campaignId", "approved");

-- CreateIndex
CREATE INDEX "Contact_campaignId_attended_idx" ON "Contact"("campaignId", "attended");

-- CreateIndex
CREATE INDEX "Contact_campaignId_registeredAt_idx" ON "Contact"("campaignId", "registeredAt");

-- CreateIndex
CREATE INDEX "Contact_campaignId_email_idx" ON "Contact"("campaignId", "email");

-- CreateIndex
CREATE INDEX "PersonalizedMessage_campaignId_stepKey_idx" ON "PersonalizedMessage"("campaignId", "stepKey");

-- CreateIndex
CREATE INDEX "PersonalizedMessage_contactId_idx" ON "PersonalizedMessage"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalizedMessage_campaignId_contactId_stepKey_key" ON "PersonalizedMessage"("campaignId", "contactId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "Template_campaignId_key_key" ON "Template"("campaignId", "key");

-- CreateIndex
CREATE INDEX "MessageTemplate_channel_status_idx" ON "MessageTemplate"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_campaignId_key_key" ON "MessageTemplate"("campaignId", "key");

-- CreateIndex
CREATE INDEX "CadenceStep_templateId_idx" ON "CadenceStep"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "CadenceStep_campaignId_key_key" ON "CadenceStep"("campaignId", "key");

-- CreateIndex
CREATE INDEX "CadenceSend_campaignId_status_dueAt_idx" ON "CadenceSend"("campaignId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "CadenceSend_campaignId_status_claimedAt_idx" ON "CadenceSend"("campaignId", "status", "claimedAt");

-- CreateIndex
CREATE INDEX "CadenceSend_campaignId_status_sentAt_idx" ON "CadenceSend"("campaignId", "status", "sentAt");

-- CreateIndex
CREATE INDEX "CadenceSend_contactId_idx" ON "CadenceSend"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "CadenceSend_campaignId_contactId_stepKey_key" ON "CadenceSend"("campaignId", "contactId", "stepKey");

-- CreateIndex
CREATE INDEX "ActivityLogEntry_campaignId_createdAt_idx" ON "ActivityLogEntry"("campaignId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "AttentionItem_campaignId_resolvedAt_createdAt_idx" ON "AttentionItem"("campaignId", "resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_campaignId_createdAt_idx" ON "ChatMessage"("campaignId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LinkedinRegistration_responseUrn_key" ON "LinkedinRegistration"("responseUrn");

-- CreateIndex
CREATE INDEX "LinkedinRegistration_processedAt_idx" ON "LinkedinRegistration"("processedAt");

-- CreateIndex
CREATE INDEX "LinkedinRegistration_claimedAt_idx" ON "LinkedinRegistration"("claimedAt");

-- CreateIndex
CREATE INDEX "LinkedinRegistration_campaignId_idx" ON "LinkedinRegistration"("campaignId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizedMessage" ADD CONSTRAINT "PersonalizedMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalizedMessage" ADD CONSTRAINT "PersonalizedMessage_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Template" ADD CONSTRAINT "Template_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageTemplate" ADD CONSTRAINT "MessageTemplate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceStep" ADD CONSTRAINT "CadenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceStep" ADD CONSTRAINT "CadenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceSend" ADD CONSTRAINT "CadenceSend_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CadenceSend" ADD CONSTRAINT "CadenceSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityLogEntry" ADD CONSTRAINT "ActivityLogEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttentionItem" ADD CONSTRAINT "AttentionItem_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedinRegistration" ADD CONSTRAINT "LinkedinRegistration_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
