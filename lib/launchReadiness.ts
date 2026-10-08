import { db } from '@/lib/db';
import { computePersonalizeReadiness } from '@/lib/cadenceReadiness';
import { getRegistrationOverviewAction } from '@/lib/actions/registration';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { getChannelDeliveryMode, DIRECT_GATEWAY_KEYS } from '@/lib/channelDelivery';
import { normalizeChannel } from '@/lib/channels';
import { registrationSecretIsWeak } from '@/lib/registration';

export async function getLaunchReadiness(campaignId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const problems: string[] = [];
  if (campaign.archived || campaign.status === 'completed' || campaign.cadenceStatus === 'stopped') problems.push('Closed or stopped campaigns must not launch.');
  if (!campaign.scheduledAt || campaign.scheduledAt <= new Date()) problems.push('Set a future webinar date and time.');
  if (registrationSecretIsWeak() && process.env.NODE_ENV === 'production') problems.push('Configure a strong REGISTRATION_SECRET.');
  const approved = await db.contact.count({ where: { campaignId, approved: true } });
  if (!approved) problems.push('Approve at least one contact before launch.');
  const steps = await db.cadenceStep.findMany({ where: { campaignId, enabled: true, removedAt: null } });
  if (!steps.length) problems.push('Enable at least one cadence step.');
  const channels = new Set(steps.map(s => normalizeChannel(s.channel)));
  if (channels.has('email')) {
    const provider = campaign.emailProvider === 'netcore' ? 'netcore' : 'lsq';
    const required = provider === 'netcore' ? ['apiKey', 'fromEmail'] : ['accessKey', 'secretKey', 'host', 'senderEmail'];
    for (const key of required) if (!(await resolveIntegrationField(provider, key))) problems.push(`Configure ${provider}.${key} before sending.`);
  }
  for (const channel of ['sms', 'whatsapp'] as const) {
    if (!channels.has(channel)) continue;
    if ((await getChannelDeliveryMode(channel)) === 'direct') {
      const endpoint = await db.appSetting.findUnique({ where: { key: DIRECT_GATEWAY_KEYS[channel].endpoint } });
      if (!endpoint?.value) problems.push(`Configure the ${channel} gateway.`);
    } else if (!(await resolveIntegrationField('lsq', 'accessKey')) || !(await resolveIntegrationField('lsq', 'secretKey'))) problems.push(`LeadSquared must be connected for ${channel} automation.`);
  }
  const content = await computePersonalizeReadiness(campaignId);
  problems.push(...content.problems);
  const overview = await getRegistrationOverviewAction(campaignId);
  if ('error' in overview) problems.push(overview.error);
  else problems.push(...overview.readiness.checks.filter(c => c.status === 'fail').map(c => `${c.label}: ${c.detail}`));
  return { ok: problems.length === 0, problems };
}
export async function assertLaunchReady(campaignId: string) {
  const readiness = await getLaunchReadiness(campaignId);
  if (!readiness.ok) throw new Error(`Launch blocked: ${readiness.problems.join(' ')}`);
}
