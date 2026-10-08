-- Public registration is separate from approval for campaign outreach.
-- Preserve explicit operator decisions and previously scored audience contacts.
UPDATE "Contact" SET "approved" = false
WHERE "source" = 'Website Registration' AND "registeredAt" IS NOT NULL
  AND "score" IS NULL AND "approved" = true AND "approvedManually" = false;
