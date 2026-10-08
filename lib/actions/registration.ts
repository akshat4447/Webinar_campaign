'use server';

import { db } from '@/lib/db';
import { appOrigin } from '@/lib/appOrigin';
import { revalidateCampaign } from '@/lib/revalidate';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { zoomConnectionError } from '@/lib/zoom/client';
import { validateLandingUrl } from '@/lib/landingUrl';
import { verifyLandingPage, type LandingReport } from '@/lib/landingVerify';
import { computeRegistrationReadiness, type Readiness } from '@/lib/registrationReadiness';
import { publicRegistrationUrl, buildPublicLandingUrl, registrationModeOf, type RegistrationMode } from '@/lib/inviteLink';
import { CHANNEL_DEFINITIONS, parseSelectedChannels } from '@/lib/registrationChannels';
import { generateUniversalEmbedScript } from '@/lib/landingPage';
import { getZoomRegistrationHealthAction } from '@/lib/actions/zoom';
import { setupLockError } from '@/lib/setupLock';

const REPORT_KEY = (campaignId: string) => `landing.report.${campaignId}`;

export interface ChannelLink {
  channel: string;
  label: string;
  url: string;
}

export interface RegistrationOverview {
  mode: RegistrationMode;
  landingUrl: string | null;
  prefill: boolean;
  oneClickSignup: boolean;
  zoomRegistrationUrl: string | null;
  readiness: Readiness;
  /** The last landing-page check for the CURRENT landing URL (null if never run or the URL changed). */
  landingReport: (LandingReport & { checkedAt: string }) | null;
  /** Contact-free links per channel (social posts, the website, partners). */
  channelLinks: ChannelLink[];
  /** The script to paste into the landing page (external mode). */
  snippet: string | null;
  appOrigin: string;
}

async function loadLastReport(campaignId: string, url: string | null): Promise<(LandingReport & { checkedAt: string }) | null> {
  if (!url) return null;
  const row = await db.appSetting.findUnique({ where: { key: REPORT_KEY(campaignId) } }).catch(() => null);
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as LandingReport & { checkedAt: string };
    return parsed.url === url ? parsed : null; // a report for a different URL is meaningless now
  } catch {
    return null;
  }
}

export async function getRegistrationOverviewAction(campaignId: string): Promise<RegistrationOverview | { error: string }> {
  const c = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!c) return { error: 'Webinar not found.' };

  const origin = appOrigin();
  const mode = registrationModeOf(c);
  const landingUrl = c.registrationLink?.trim() || null;
  const landingReport = await loadLastReport(campaignId, landingUrl);

  const zoomConnected = !(await zoomConnectionError());
  const health = c.zoomMeetingId ? await getZoomRegistrationHealthAction(campaignId) : { linked: false as const };
  const webhookSecretSet = Boolean(await resolveIntegrationField('zoom', 'webhookSecret'));
  const lsqConfigured = Boolean((await resolveIntegrationField('lsq', 'accessKey')) && (await resolveIntegrationField('lsq', 'secretKey')));

  const readiness = computeRegistrationReadiness({
    campaign: c,
    appOrigin: origin,
    zoom: { connected: zoomConnected, health: health.linked ? { registrationEnabled: health.registrationEnabled, kind: health.kind, error: health.error } : null, webhookSecretSet },
    lsqConfigured,
    landing: mode === 'external' ? landingReport : null,
  });

  const channels = parseSelectedChannels(c.selectedChannels);
  const channelLinks: ChannelLink[] = channels.map((key) => ({
    channel: key,
    label: CHANNEL_DEFINITIONS[key]?.label ?? key,
    url:
      mode === 'external' && landingUrl
        ? buildPublicLandingUrl({ landingPageUrl: landingUrl, campaign: c, channel: key, appOrigin: origin })
        : publicRegistrationUrl(origin, c.id, key),
  }));

  const snippet =
    mode === 'external'
      ? generateUniversalEmbedScript({
          apiOrigin: origin,
          campaignId: c.id,
          zoomId: c.zoomMeetingId ?? undefined,
          webinarTitle: c.name,
          scheduledAt: c.scheduledAt,
          durationMinutes: c.durationMinutes,
          description: c.description ?? undefined,
          location: c.zoomLink ?? undefined,
        })
      : null;

  return {
    mode,
    landingUrl,
    prefill: Boolean(c.landingPrefill),
    oneClickSignup: c.oneClickSignup,
    zoomRegistrationUrl: c.zoomRegistrationUrl,
    readiness,
    landingReport,
    channelLinks,
    snippet,
    appOrigin: origin,
  };
}

export type SaveRegistrationResult = { ok: true; warnings: string[] } | { ok: false; error: string };

export async function saveRegistrationSettingsAction(
  campaignId: string,
  input: { mode: RegistrationMode; landingUrl?: string | null; prefill?: boolean; oneClickSignup?: boolean }
): Promise<SaveRegistrationResult> {
  if (input.mode !== 'zoom' && input.mode !== 'external') return { ok: false, error: 'Choose how people register.' };
  const locked = await setupLockError(campaignId);
  if (locked) return { ok: false, error: locked };
  const exists = await db.campaign.findUnique({ where: { id: campaignId }, select: { id: true } });
  if (!exists) return { ok: false, error: 'Webinar not found.' };

  const data: Record<string, unknown> = { registrationMode: input.mode };
  let warnings: string[] = [];

  if (input.mode === 'external') {
    const v = validateLandingUrl(input.landingUrl);
    if (!v.ok) return { ok: false, error: v.error ?? 'Enter a valid landing page address.' };
    data.registrationLink = v.url;
    warnings = v.warnings;
    if (input.prefill !== undefined) data.landingPrefill = Boolean(input.prefill);
  } else if (input.oneClickSignup !== undefined) {
    data.oneClickSignup = Boolean(input.oneClickSignup);
  }
  if (input.mode === 'external') data.oneClickSignup = false;
  else if (input.oneClickSignup === undefined) data.oneClickSignup = true;

  await db.campaign.update({ where: { id: campaignId }, data });
  await db.activityLogEntry.create({
    data: {
      campaignId,
      text: input.mode === 'external' ? `Registration set to the external landing page ${data.registrationLink}` : 'Registration set to Webinar Studio (Zoom registration)',
      dot: 'var(--accent-500)',
    },
  });
  revalidateCampaign(campaignId);
  return { ok: true, warnings };
}

export async function verifyLandingPageAction(campaignId: string, url?: string | null): Promise<LandingReport & { checkedAt: string }> {
  const c = await db.campaign.findUnique({ where: { id: campaignId }, select: { registrationLink: true } });
  const target = (url ?? c?.registrationLink ?? '').trim();
  const v = validateLandingUrl(target);
  const report: LandingReport = v.ok
    ? await verifyLandingPage(v.url as string, appOrigin())
    : { url: target, finalUrl: null, status: null, title: null, platform: 'unknown', embeddable: false, overall: 'fail', checks: [{ id: 'reachable', label: 'Page loads', status: 'fail', detail: v.error ?? 'Invalid address.', fix: 'Enter a valid landing page address.' }] };
  const stamped = { ...report, url: v.ok ? (v.url as string) : target, checkedAt: new Date().toISOString() };
  const key = REPORT_KEY(campaignId);
  await db.appSetting.upsert({ where: { key }, create: { key, value: JSON.stringify(stamped) }, update: { value: JSON.stringify(stamped) } }).catch(() => undefined);
  revalidateCampaign(campaignId);
  return stamped;
}
