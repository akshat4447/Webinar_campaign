// Pure. The ONE place that decides which link goes into a message for a contact.
//
// Two registration modes (see docs/MASTER_PLAN.md):
//
//   zoom      Studio hosts registration and registers the person on Zoom.
//             - oneClickSignup ON  : a signed one-click link  /r/<token>?source=<channel>
//             - oneClickSignup OFF : the hosted form          /register/<campaignId>?c=<channel>&t=<token>
//   external  The operator's own landing page (registrationLink) registers people through the
//             landing-submit endpoint / LeadSquared webhook. The link is that page plus UTM +
//             the signed token (and, only when landingPrefill is on, the contact's details).
//
// Zoom sync is independent of the mode: it happens whenever a Zoom event is linked.
// Channel attribution is always done by Studio via the `source`/`utm_source` we put on the link.

import { mintRegistrationToken } from '@/lib/registration';
import { buildLandingPageUrl } from '@/lib/landingPageServer';

export type RegistrationMode = 'zoom' | 'external';

/**
 * Channels with a hard length budget (a LinkedIn connection note is 300 characters; an SMS segment is 160).
 * In external mode their link is the short `/r/<token>` redirect, which expands to the full landing URL
 * (UTM, ids, optional pre-fill) server-side, instead of a ~500-character query string.
 */
export const SHORT_LINK_CHANNELS = new Set(['linkedin', 'sms']);

export interface InviteCampaign {
  id: string;
  name?: string | null;
  registrationMode?: string | null;
  registrationLink?: string | null;
  oneClickSignup?: boolean | null;
  landingPrefill?: boolean | null;
  zoomLink?: string | null;
  zoomMeetingId?: string | null;
}

export interface InviteContact {
  id: string;
  registeredAt?: Date | null;
  zoomJoinUrl?: string | null;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  account?: string | null;
  title?: string | null;
}

/**
 * The effective mode. `external` needs a landing URL to be meaningful; an `external` webinar with
 * no URL yet behaves as `zoom` so a half-configured webinar still produces a working link.
 * Rows that predate the column (undefined) fall back to the old implicit rule: a landing URL with
 * one-click signup off meant "external".
 */
export function registrationModeOf(c: Pick<InviteCampaign, 'registrationMode' | 'registrationLink' | 'oneClickSignup'>): RegistrationMode {
  const hasLanding = Boolean(c.registrationLink && c.registrationLink.trim());
  if (c.registrationMode === 'external') return hasLanding ? 'external' : 'zoom';
  if (c.registrationMode === 'zoom') return 'zoom';
  return hasLanding && c.oneClickSignup === false ? 'external' : 'zoom';
}

function origin(o: string): string {
  return o.replace(/\/+$/, '');
}

/** Hosted registration form link (zoom mode without one-click). */
export function hostedFormUrl(appOrigin: string, campaignId: string, channel: string, token?: string): string {
  const u = new URL(`${origin(appOrigin)}/register/${encodeURIComponent(campaignId)}`);
  u.searchParams.set('c', channel);
  if (token) u.searchParams.set('t', token);
  return u.toString();
}

/** Public hosted registration link with no contact identity — for social posts, the website, partners. */
export function publicRegistrationUrl(appOrigin: string, campaignId: string, channel: string): string {
  return hostedFormUrl(appOrigin, campaignId, channel);
}

export function buildInviteLink(args: { campaign: InviteCampaign; contact: InviteContact; channel?: string; appOrigin: string }): string {
  const { campaign, contact, appOrigin } = args;
  const channel = (args.channel || 'email').toLowerCase();
  const mode = registrationModeOf(campaign);

  // Someone who already registered should get the event link, not another "register here".
  if (contact.registeredAt) {
    return contact.zoomJoinUrl || campaign.zoomLink || campaign.registrationLink || '';
  }

  if (mode === 'external' && !SHORT_LINK_CHANNELS.has(channel)) {
    return buildLandingPageUrl({
      landingPageUrl: campaign.registrationLink as string,
      campaign: { id: campaign.id, name: campaign.name, zoomMeetingId: campaign.zoomMeetingId },
      contact,
      channel,
      apiOrigin: origin(appOrigin),
      prefill: campaign.landingPrefill ?? false,
    });
  }

  const token = mintRegistrationToken(campaign.id, contact.id);
  if (mode === 'external') return `${origin(appOrigin)}/r/${token}?source=${encodeURIComponent(channel)}`;
  if (campaign.oneClickSignup === false) return hostedFormUrl(appOrigin, campaign.id, channel, token);

  const base = `${origin(appOrigin)}/r/${token}`;
  return `${base}?source=${encodeURIComponent(channel)}`;
}

/**
 * The landing-page link for a channel with NO contact identity (social posts, the website, partners):
 * the page plus UTM and the campaign id. No token, no personal data.
 */
export function buildPublicLandingUrl(args: { landingPageUrl: string; campaign: { id: string; name?: string | null; zoomMeetingId?: string | null }; channel?: string; appOrigin?: string }): string {
  const trimmed = (args.landingPageUrl || '').trim();
  if (!trimmed) return '';
  const channel = (args.channel || 'website').toLowerCase();
  const slug = args.campaign.name ? args.campaign.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : args.campaign.id;
  try {
    const u = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    u.searchParams.set('source', channel);
    u.searchParams.set('utm_source', channel);
    u.searchParams.set('utm_medium', 'webinar');
    u.searchParams.set('utm_campaign', slug);
    u.searchParams.set('campaignId', args.campaign.id);
    if (args.campaign.zoomMeetingId) u.searchParams.set('zoomId', args.campaign.zoomMeetingId);
    if (args.appOrigin) u.searchParams.set('apiOrigin', origin(args.appOrigin));
    return u.toString();
  } catch {
    return '';
  }
}
