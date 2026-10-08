-- Registration modes + Zoom event kind.
--
-- registrationMode  'zoom'     Studio-hosted registration (signed one-click links and the
--                              hosted /register form) backed by a Zoom registrant.
--                   'external' The operator's own landing page (registrationLink) registers
--                              people through the landing-submit endpoint / LeadSquared webhook.
--                   Zoom sync is independent of the mode: it applies whenever a Zoom
--                   meeting is linked.
-- zoomRegistrationUrl  Zoom's own hosted registration page (registration_url returned when a
--                      meeting is created with registration on). Optional extra link.
-- zoomEventType     'meeting' | 'webinar' — which Zoom API family the linked id belongs to, so
--                   registrants are added with the right endpoint instead of trying one and
--                   falling back on ANY error.
-- All three are additive and nullable/defaulted: existing rows keep working unchanged.
ALTER TABLE "Campaign" ADD COLUMN "registrationMode" TEXT NOT NULL DEFAULT 'zoom';
ALTER TABLE "Campaign" ADD COLUMN "zoomRegistrationUrl" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "zoomEventType" TEXT;

-- Existing webinars that were configured with a custom landing page keep behaving the same:
-- a stored registrationLink with one-click signup off means "external".
UPDATE "Campaign" SET "registrationMode" = 'external'
WHERE "registrationLink" IS NOT NULL AND "registrationLink" <> '' AND "oneClickSignup" = false;
