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
    "offsetValue" INTEGER NOT NULL DEFAULT 0,
    "offsetUnit" TEXT NOT NULL DEFAULT 'days',
    "anchor" TEXT NOT NULL DEFAULT 'launch',
    CONSTRAINT "CadenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CadenceStep" ("anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "timing", "title", "toggleable") SELECT "anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "timing", "title", "toggleable" FROM "CadenceStep";
DROP TABLE "CadenceStep";
ALTER TABLE "new_CadenceStep" RENAME TO "CadenceStep";
CREATE UNIQUE INDEX "CadenceStep_campaignId_key_key" ON "CadenceStep"("campaignId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill `trigger` for steps that existed before this column.
--
-- Everything defaults to 'launch', which is correct for the majority. These are
-- the exceptions, and they encode what lib/cadence.ts previously expressed as a
-- hardcoded allowlist of step keys:
--
--   confirm, whatsapp  fire per registration as it arrives
--   attend, noshow     fire on the attendance import, which is the only thing
--                      that knows who actually turned up
--
-- The `linkedin` step stays 'launch' on purpose: it IS queued at launch, into
-- the assisted queue rather than the send queue. Its exclusion from automatic
-- sending is a property of its channel, not of its trigger, and conflating the
-- two here is what made the old allowlist unable to describe a new step.
UPDATE "CadenceStep" SET "trigger" = 'registration' WHERE "key" IN ('confirm', 'whatsapp');
UPDATE "CadenceStep" SET "trigger" = 'attendance'   WHERE "key" IN ('attend', 'noshow');
