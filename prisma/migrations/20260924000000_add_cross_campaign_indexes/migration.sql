-- Cross-campaign analytics indexes.
--
-- Every pre-existing Contact/CadenceSend index is campaignId-prefixed, so the
-- dashboard's fleet-wide aggregates (which filter on registeredAt / createdAt /
-- status+sentAt with no campaignId) could not use any of them and fell back to
-- sequential scans over the two largest tables in the schema.
--
-- CONCURRENTLY is deliberately not used: Prisma migrations run inside a
-- transaction, which CREATE INDEX CONCURRENTLY forbids. These tables are small
-- enough at deploy time that a brief lock is the right trade; for a very large
-- existing dataset, create them out-of-band instead and mark this applied.
CREATE INDEX "Contact_registeredAt_idx" ON "Contact"("registeredAt");
CREATE INDEX "Contact_createdAt_idx" ON "Contact"("createdAt");
CREATE INDEX "Contact_campaignId_score_idx" ON "Contact"("campaignId", "score");
CREATE INDEX "CadenceSend_status_sentAt_idx" ON "CadenceSend"("status", "sentAt");
CREATE INDEX "CadenceSend_stepKey_status_sentAt_idx" ON "CadenceSend"("stepKey", "status", "sentAt");
