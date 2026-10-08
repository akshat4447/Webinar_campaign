-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "stopOnRegistration" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Campaign" ADD COLUMN "stopOnDecline" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Campaign" ADD COLUMN "suppressionPreflight" BOOLEAN NOT NULL DEFAULT true;
