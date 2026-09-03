-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "savedAt" DATETIME,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MessageTemplate_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

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
    "offsetValue" INTEGER NOT NULL DEFAULT 0,
    "offsetUnit" TEXT NOT NULL DEFAULT 'days',
    "anchor" TEXT NOT NULL DEFAULT 'launch',
    CONSTRAINT "CadenceStep_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CadenceStep_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_CadenceStep" ("anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "timing", "title", "toggleable", "trigger") SELECT "anchor", "campaignId", "channel", "desc", "enabled", "group", "id", "isRoadmap", "key", "offsetUnit", "offsetValue", "timing", "title", "toggleable", "trigger" FROM "CadenceStep";
DROP TABLE "CadenceStep";
ALTER TABLE "new_CadenceStep" RENAME TO "CadenceStep";
CREATE UNIQUE INDEX "CadenceStep_campaignId_key_key" ON "CadenceStep"("campaignId", "key");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MessageTemplate_channel_status_idx" ON "MessageTemplate"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_campaignId_key_key" ON "MessageTemplate"("campaignId", "key");

-- ---------------------------------------------------------------------------
-- Data migration: per-campaign Templates -> shared library + overrides
-- ---------------------------------------------------------------------------
--
-- Before: every campaign carried its own copy of all fifteen built-in
-- messages. 16 campaigns x 15 keys = 240 near-identical rows, and fixing a
-- typo meant editing it 16 times.
--
-- After: one library row per key, plus a campaign-scoped copy ONLY where that
-- campaign actually customised the message. Customisation means the operator
-- saved an edit (savedAt is set) or hid the template. Everything else points
-- at the library row.
--
-- Nothing is deleted. The old Template table is left exactly as it is, so this
-- migration is reversible by dropping MessageTemplate and clearing templateId.

-- 1. Library rows: one per key, taken from the earliest-created campaign that
--    has that key, preferring a campaign that never edited it so the library
--    default is a default rather than somebody's customisation.
INSERT INTO "MessageTemplate" (
  "id", "campaignId", "channel", "key", "name", "hasSubject", "subject", "body",
  "status", "hidden", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  NULL,
  CASE
    WHEN lower(t."channel") LIKE '%sms%'      THEN 'sms'
    WHEN lower(t."channel") LIKE '%whatsapp%' THEN 'whatsapp'
    WHEN lower(t."channel") LIKE '%linkedin%' AND lower(t."channel") NOT LIKE '%email%' THEN 'linkedin'
    ELSE 'email'
  END,
  t."key",
  t."label",
  t."hasSubject",
  t."subject",
  t."body",
  -- LinkedIn is assisted by nature: there is no send API and so no approval
  -- state. Everything else carries over as usable, because it is in use today.
  CASE
    WHEN lower(t."channel") LIKE '%linkedin%' AND lower(t."channel") NOT LIKE '%email%' THEN 'assisted'
    ELSE 'ready'
  END,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Template" t
WHERE t."id" = (
  SELECT t2."id"
  FROM "Template" t2
  JOIN "Campaign" c2 ON c2."id" = t2."campaignId"
  WHERE t2."key" = t."key"
  -- Prefer an unedited copy; fall back to the oldest campaign's copy.
  ORDER BY (CASE WHEN t2."savedAt" IS NULL THEN 0 ELSE 1 END), c2."createdAt"
  LIMIT 1
);

-- 2. Campaign-scoped overrides, only where the campaign actually customised
--    the message. Preserves the edit, the saved-revert history and hidden.
INSERT INTO "MessageTemplate" (
  "id", "campaignId", "channel", "key", "name", "hasSubject", "subject", "body",
  "status", "savedSubject", "savedBody", "savedAt", "hidden", "createdAt", "updatedAt"
)
SELECT
  lower(hex(randomblob(12))),
  t."campaignId",
  CASE
    WHEN lower(t."channel") LIKE '%sms%'      THEN 'sms'
    WHEN lower(t."channel") LIKE '%whatsapp%' THEN 'whatsapp'
    WHEN lower(t."channel") LIKE '%linkedin%' AND lower(t."channel") NOT LIKE '%email%' THEN 'linkedin'
    ELSE 'email'
  END,
  t."key",
  t."label",
  t."hasSubject",
  t."subject",
  t."body",
  CASE
    WHEN lower(t."channel") LIKE '%linkedin%' AND lower(t."channel") NOT LIKE '%email%' THEN 'assisted'
    ELSE 'ready'
  END,
  t."savedSubject",
  t."savedBody",
  t."savedAt",
  t."hidden",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Template" t
WHERE t."savedAt" IS NOT NULL OR t."hidden" = 1;

-- 3. Point every cadence step at its message: the campaign's own override if
--    it made one, otherwise the library row for that key.
UPDATE "CadenceStep"
SET "templateId" = COALESCE(
  (SELECT m."id" FROM "MessageTemplate" m
    WHERE m."campaignId" = "CadenceStep"."campaignId" AND m."key" = "CadenceStep"."key"),
  (SELECT m."id" FROM "MessageTemplate" m
    WHERE m."campaignId" IS NULL AND m."key" = "CadenceStep"."key")
);
