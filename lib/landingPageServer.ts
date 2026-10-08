import { mintRegistrationToken } from '@/lib/registration';
import { buildLandingPageUrl as buildUrl, type BuildLandingUrlOptions } from '@/lib/landingPage';
export * from '@/lib/landingPage';
export function buildLandingPageUrl(options: BuildLandingUrlOptions): string {
  return buildUrl({ ...options, registrationToken: mintRegistrationToken(options.campaign.id, options.contact.id) });
}

/** Signed links are generated only for a real server-side contact ID. */
export function buildNormalChannelRegistrationLinks(campaign: { id: string }, contactId: string, appOrigin: string) {
  const token = mintRegistrationToken(campaign.id, contactId);
  const url = (channel: string) => `${appOrigin.replace(/\/$/, '')}/r/${encodeURIComponent(token)}?source=${channel}`;
  return { email: url('email'), whatsapp: url('whatsapp'), sms: url('sms'), linkedin: url('linkedin') };
}
