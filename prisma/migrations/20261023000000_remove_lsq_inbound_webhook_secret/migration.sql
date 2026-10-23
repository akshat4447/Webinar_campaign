-- The LeadSquared inbound registration webhook (its receiving route, its settings section and its signing
-- secret) was removed. Registrations are recorded by the registration page, one-click links and the landing
-- page script instead. Drop the secret that was generated for it so no unused credential stays stored.
DELETE FROM "AppSetting" WHERE "key" = 'integration.lsq.webhookSecret';
