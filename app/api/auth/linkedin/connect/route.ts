// Step 1 of OAuth: mint a CSRF state, persist it briefly, redirect to
// LinkedIn's authorize URL with every scope this feature needs.
import { randomUUID } from 'crypto';
import { db } from '@/lib/db';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { buildAuthorizationUrl } from '@/lib/linkedin/auth';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const fail = (detail: string) => Response.redirect(new URL(`/integrations?connected=error&detail=${encodeURIComponent(detail)}`, origin).toString(), 302);

  const clientId = (await resolveIntegrationField('linkedin', 'clientId')) || process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = (await resolveIntegrationField('linkedin', 'clientSecret')) || process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return fail('Save your LinkedIn app Client ID and Client Secret first (Integrations → LinkedIn).');
  }

  const state = randomUUID();
  const now = new Date().toISOString();
  await db.$transaction([
    db.appSetting.upsert({ where: { key: 'integration.linkedin.oauthState' }, create: { key: 'integration.linkedin.oauthState', value: state }, update: { value: state } }),
    db.appSetting.upsert({ where: { key: 'integration.linkedin.oauthStateAt' }, create: { key: 'integration.linkedin.oauthStateAt', value: now }, update: { value: now } }),
  ]);

  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${origin}/api/auth/linkedin/callback`;
  return Response.redirect(buildAuthorizationUrl({ clientId, redirectUri, state }), 302);
}