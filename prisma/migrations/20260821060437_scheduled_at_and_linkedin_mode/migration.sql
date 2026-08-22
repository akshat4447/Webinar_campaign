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
    "cadenceStatus" TEXT NOT NULL DEFAULT 'not_started',
    "linkedinMode" TEXT NOT NULL DEFAULT 'assisted',
    "simulatedNow" DATETIME,
    "attendanceImportedAt" DATETIME,
    "lsqListId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Campaign" ("attendance", "attendanceImportedAt", "cadenceStatus", "createdAt", "dailyLimit", "date", "demoRequests", "frequency", "id", "invites", "lsqListId", "name", "registrationLink", "registrations", "scheduleWindow", "scoringCriteria", "scoringPrompt", "scoringThreshold", "simulatedNow", "status", "updatedAt", "vertical") SELECT "attendance", "attendanceImportedAt", "cadenceStatus", "createdAt", "dailyLimit", "date", "demoRequests", "frequency", "id", "invites", "lsqListId", "name", "registrationLink", "registrations", "scheduleWindow", "scoringCriteria", "scoringPrompt", "scoringThreshold", "simulatedNow", "status", "updatedAt", "vertical" FROM "Campaign";
DROP TABLE "Campaign";
ALTER TABLE "new_Campaign" RENAME TO "Campaign";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
