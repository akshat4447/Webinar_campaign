-- Preserve prior delivery claims. A claim alone is not proof of acceptance.
INSERT INTO "DeliveryAttempt" ("key", "campaignId", "sendId", "provider", "status", "error")
SELECT substring(a."key" from 6), s."campaignId", s."id", c.kind,
  CASE WHEN s."status" = 'sent' THEN 'accepted' ELSE 'unknown' END,
  CASE WHEN s."status" = 'sent' THEN NULL ELSE 'Legacy dispatch claim: verify the provider outcome before retrying.' END
FROM "AppSetting" a JOIN "CadenceSend" s ON true
CROSS JOIN (VALUES ('email'), ('sms'), ('whatsapp')) c(kind)
WHERE a."key" = 'idem:delivery:' || substring(encode(sha256(convert_to(s."id" || '␟' || c.kind, 'UTF8')), 'hex') from 1 for 40)
ON CONFLICT DO NOTHING;
