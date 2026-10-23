-- Netcore Cloud is the only email gateway: the per-campaign choice and the workspace default are gone.
ALTER TABLE "Campaign" DROP COLUMN "emailProvider";
DELETE FROM "AppSetting" WHERE "key" = 'default_email_provider';
