-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "emailProvider" TEXT NOT NULL DEFAULT 'leadsquared';

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "unsubscribedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'netcore',
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailSuppression_email_key" ON "EmailSuppression"("email");

-- CreateIndex
CREATE INDEX "EmailSuppression_reason_idx" ON "EmailSuppression"("reason");
