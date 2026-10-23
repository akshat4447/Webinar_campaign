-- Email and LinkedIn no longer post a mapped LeadSquared activity; drop any saved mapping for them.
UPDATE "AppSetting"
SET "value" = (("value")::jsonb - 'email' - 'linkedin')::text
WHERE "key" = 'lsq_activity_map_setting'
  AND "value" ~ '^\s*\{';
