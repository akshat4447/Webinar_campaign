-- AlterTable
ALTER TABLE "CadenceStep" ADD COLUMN "mode" TEXT DEFAULT 'ai';
ALTER TABLE "CadenceStep" ADD COLUMN "instruction" TEXT;
