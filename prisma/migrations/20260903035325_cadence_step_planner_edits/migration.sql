-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CadenceStep" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "removedAt" DATETIME,
    "offsetValue" INTEGER NOT NULL DEFAULT 0,
    "offsetUnit" TEXT NOT NULL DEFAULT 'days',
    "anchor" TEXT NOT NULL DEFAULT 'launch',
    CONSTRAINT "CadenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CadenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CadenceStep" ("anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "templateId", "timing", "title", "toggleable", "trigger") SELECT "anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "templateId", "timing", "title", "toggleable", "trigger" FROM "CadenceStep";
DROP TABLE "CadenceStep";
ALTER TABLE "new_CadenceStep" RENAME TO "CadenceStep";
CREATE UNIQUE INDEX "CadenceStep_campaignId_key_key" ON "CadenceStep"("campaignId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
