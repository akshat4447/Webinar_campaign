-- Creation wizard draft state: where a draft was left, and the revision used for autosave conflict detection.
-- Every column is defaulted, so existing campaigns stay valid and existing drafts resume at the first step.
ALTER TABLE "Campaign"
  ADD COLUMN "wizardStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "wizardFurthestStep" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draftRevision" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "draftFieldRevs" TEXT,
  ADD COLUMN "draftTouchedAt" TIMESTAMP(3);

-- The sidebar shortcut and the list ask for the most recently touched drafts.
CREATE INDEX "Campaign_status_draftTouchedAt_idx" ON "Campaign"("status", "draftTouchedAt");

-- Drafts made before the wizard tracked its position: place them where their data says they got to, so
-- "Continue Setup" does not send someone with an imported and scored list back to the first screen.
UPDATE "Campaign" SET "wizardStep" = 1, "wizardFurthestStep" = 1
 WHERE "status" = 'draft' AND EXISTS (SELECT 1 FROM "Contact" WHERE "Contact"."campaignId" = "Campaign"."id");
UPDATE "Campaign" SET "wizardStep" = 2, "wizardFurthestStep" = 2
 WHERE "status" = 'draft' AND EXISTS (SELECT 1 FROM "Contact" WHERE "Contact"."campaignId" = "Campaign"."id" AND "Contact"."score" IS NOT NULL);
