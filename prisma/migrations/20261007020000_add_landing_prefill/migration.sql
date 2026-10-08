-- landingPrefill: whether links to the operator's external landing page carry the contact's name,
-- email, phone, company and title as URL parameters (needed by LeadSquared forms that pre-fill from
-- the query string). Off by default for new webinars — personal data in URLs ends up in analytics,
-- server logs and referrers (audit finding F-11). Existing external-page webinars keep working.
ALTER TABLE "Campaign" ADD COLUMN "landingPrefill" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Campaign" SET "landingPrefill" = true WHERE "registrationMode" = 'external';
