-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "vertical" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "scheduledAt" DATETIME,
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
    "cadenceStatus" TEXT NOT NULL DEFAULT 'not_started',
    "linkedinMode" TEXT NOT NULL DEFAULT 'assisted',
    "simulatedNow" DATETIME,
    "attendanceImportedAt" DATETIME,
    "lsqListId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Campaign" ("attendance", "attendanceImportedAt", "cadenceStatus", "createdAt", "dailyLimit", "date", "demoRequests", "description", "frequency", "id", "invites", "linkedinMode", "lsqListId", "name", "personalizationPrompt", "registrationLink", "registrations", "scheduleWindow", "scheduledAt", "scoringCriteria", "scoringPrompt", "scoringThreshold", "simulatedNow", "status", "updatedAt", "vertical", "zoomLink") SELECT "attendance", "attendanceImportedAt", "cadenceStatus", "createdAt", "dailyLimit", "date", "demoRequests", "description", "frequency", "id", "invites", "linkedinMode", "lsqListId", "name", "personalizationPrompt", "registrationLink", "registrations", "scheduleWindow", "scheduledAt", "scoringCriteria", "scoringPrompt", "scoringThreshold", "simulatedNow", "status", "updatedAt", "vertical", "zoomLink" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
