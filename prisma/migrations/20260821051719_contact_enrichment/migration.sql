-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "score" INTEGER,
    "explanation" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Apollo',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "lsqLeadId" TEXT,
    "enrichedAt" DATETIME,
    "enrichmentSource" TEXT,
    "personaNote" TEXT,
    "emailSimulated" BOOLEAN NOT NULL DEFAULT false,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "watchMinutes" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Contact_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Contact" ("account", "approved", "attended", "campaignId", "createdAt", "email", "explanation", "function", "id", "linkedinId", "lsqLeadId", "missingInfo", "name", "score", "seniority", "source", "title", "vertical", "watchMinutes") SELECT "account", "approved", "attended", "campaignId", "createdAt", "email", "explanation", "function", "id", "linkedinId", "lsqLeadId", "missingInfo", "name", "score", "seniority", "source", "title", "vertical", "watchMinutes" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
