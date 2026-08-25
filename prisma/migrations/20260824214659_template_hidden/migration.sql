-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Template" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "campaignId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "hasSubject" BOOLEAN NOT NULL DEFAULT true,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "savedSubject" TEXT,
    "savedBody" TEXT,
    "savedAt" DATETIME,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Template_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Template" ("body", "campaignId", "channel", "hasSubject", "id", "key", "label", "savedAt", "savedBody", "savedSubject", "subject", "updatedAt") SELECT "body", "campaignId", "channel", "hasSubject", "id", "key", "label", "savedAt", "savedBody", "savedSubject", "subject", "updatedAt" FROM "Template";
DROP TABLE "Template";
ALTER TABLE "new_Template" RENAME TO "Template";
CREATE UNIQUE INDEX "Template_campaignId_key_key" ON "Template"("campaignId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
