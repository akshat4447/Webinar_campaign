import { appOrigin } from '@/lib/appOrigin';

export type RegistrationChannelKey =
  | 'email_campaign'
  | 'sms'
  | 'whatsapp'
  | 'linkedin'
  | 'sdr_sales'
  | 'third_parties'
  | 'linkedin_event'
  | 'website';

export interface ChannelDefinition {
  key: RegistrationChannelKey;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: 'outreach' | 'inbound' | 'sales' | 'partner' | 'social';
}

export const CHANNEL_DEFINITIONS: Record<RegistrationChannelKey, ChannelDefinition> = {
  email_campaign: {
    key: 'email_campaign',
    label: 'Email Campaign',
    icon: '📧',
    color: 'var(--accent-600, #2563eb)',
    description: 'Automated email sequences via Netcore or LeadSquared',
    category: 'outreach',
  },
  sms: {
    key: 'sms', label: 'SMS', icon: '📱', color: '#0369a1',
    description: 'SMS invitations and reminders via your configured delivery provider', category: 'outreach',
  },
  whatsapp: {
    key: 'whatsapp',
    label: 'WhatsApp',
    icon: '💬',
    color: '#16a34a',
    description: 'WhatsApp template sends and broadcast CTA links',
    category: 'outreach',
  },
  linkedin: {
    key: 'linkedin',
    label: 'LinkedIn',
    icon: '💼',
    color: '#0284c7',
    description: '1-on-1 LinkedIn InMail & direct sales messaging',
    category: 'outreach',
  },
  sdr_sales: {
    key: 'sdr_sales',
    label: 'SDR/Sales',
    icon: '🤝',
    color: '#0d9488',
    description: 'Direct sales rep outreach, phone calls & personal invites',
    category: 'sales',
  },
  third_parties: {
    key: 'third_parties',
    label: 'Third-parties',
    icon: '🌐',
    color: '#d97706',
    description: 'Partner webinars, syndication, sponsor newsletters & media affiliates',
    category: 'partner',
  },
  linkedin_event: {
    key: 'linkedin_event',
    label: 'LinkedIn Event Page',
    icon: '📢',
    color: '#7c3aed',
    description: 'Native LinkedIn Event page & lead gen forms',
    category: 'social',
  },
  website: {
    key: 'website',
    label: 'Website',
    icon: '🖥️',
    color: '#dc2626',
    description: 'Official company website banner, header, blog & event listing',
    category: 'inbound',
  },
};

export const DEFAULT_SELECTED_CHANNELS: RegistrationChannelKey[] = [
  'email_campaign',
  'sms',
  'whatsapp',
  'linkedin',
  'sdr_sales',
  'third_parties',
  'linkedin_event',
  'website',
];

export function parseSelectedChannels(raw?: string | null): RegistrationChannelKey[] {
  if (!raw || !raw.trim()) return [...DEFAULT_SELECTED_CHANNELS];
  const parsed = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .map((s) => {
      // Tolerate legacy values
      if (s === 'email') return 'email_campaign';
      if (s === 'landing_page' || s === 'framer' || s === 'zoom' || s === 'other') return 'website';
      return s as RegistrationChannelKey;
    })
    .filter((k): k is RegistrationChannelKey => k in CHANNEL_DEFINITIONS);

  return parsed.length > 0 ? [...new Set(parsed)] : [...DEFAULT_SELECTED_CHANNELS];
}

export function serializeSelectedChannels(channels: RegistrationChannelKey[]): string {
  return channels.join(',');
}

export interface ChannelRegistrationStat {
  key: RegistrationChannelKey;
  label: string;
  icon: string;
  color: string;
  description: string;
  category: 'outreach' | 'inbound' | 'sales' | 'partner' | 'social';
  registeredCount: number;
  pctOfTotal: number;
  invitedCount: number;
  conversionRate: number | null;
  trackingUrl: string | null;
  contacts: Array<{
    id: string;
    name: string;
    email: string | null;
    phone: string | null;
    account: string;
    title: string;
    registeredAt: Date | null;
    score: number | null;
    zoomJoinUrl?: string | null;
  }>;
}

export interface CampaignRegistrationOverview {
  totalRegistered: number;
  /** Registrations counted in the campaign total that have no contact record (and so no channel). */
  untrackedRegistered: number;
  selectedChannels: RegistrationChannelKey[];
  channels: ChannelRegistrationStat[];
  topChannel: ChannelRegistrationStat | null;
}

/**
 * Resolves which of the 8 channels a registered contact belongs to.
 */
export function resolveContactRegistrationChannel(
  contact: { registrationSource?: string | null; id: string },
  inviteSendsByContact: Map<string, Set<string>>
): RegistrationChannelKey {
  const raw = (contact.registrationSource ?? '').toLowerCase().trim();
  const normalized = raw.replace(/[-\s/]+/g, '_');

  if (
    normalized.includes('email') ||
    normalized.includes('netcore') ||
    normalized === 'lsq_email'
  ) {
    return 'email_campaign';
  }

  if (normalized.includes('whatsapp') || normalized === 'wa') {
    return 'whatsapp';
  }

  if (
    normalized.includes('linkedin_event') ||
    normalized.includes('event_page') ||
    normalized.includes('linkedin_reg')
  ) {
    return 'linkedin_event';
  }

  if (
    normalized.includes('linkedin') ||
    normalized.includes('inmail')
  ) {
    return 'linkedin';
  }

  if (normalized.includes('sms') || normalized.includes('text_message')) return 'sms';

  if (
    normalized.includes('sdr') ||
    normalized.includes('sales') ||
    normalized.includes('rep') ||
    normalized.includes('phone')
  ) {
    return 'sdr_sales';
  }

  if (
    normalized.includes('third_part') ||
    normalized.includes('thirdparty') ||
    normalized.includes('partner') ||
    normalized.includes('affiliate') ||
    normalized.includes('sponsor')
  ) {
    return 'third_parties';
  }

  if (
    normalized.includes('website') ||
    normalized.includes('framer') ||
    normalized.includes('landing') ||
    normalized.includes('site') ||
    normalized.includes('web') ||
    normalized.includes('direct') ||
    normalized.includes('zoom')
  ) {
    return 'website';
  }

  // Fallback if source was stored generically ('one_click' or empty):
  // Check which channel's invite step was sent to this contact
  const sentSteps = inviteSendsByContact.get(contact.id);
  if (sentSteps) {
    if (sentSteps.has('waInvite')) return 'whatsapp';
    if (sentSteps.has('linkedin')) return 'linkedin';
    if (sentSteps.has('smsInvite')) return 'sms';
    if (sentSteps.has('invite')) return 'email_campaign';
  }

  if (raw === 'one_click') return 'email_campaign';
  return 'website';
}

/**
 * Builds tracking links for each of the 8 channels.
 */
export function buildAllChannelTrackingUrls(
  campaign: {
    id: string;
    name?: string | null;
    registrationLink?: string | null;
    zoomMeetingId?: string | null;
    zoomLink?: string | null;
  },
  origin = appOrigin()
): Record<RegistrationChannelKey, string> {
  const result: Partial<Record<RegistrationChannelKey, string>> = {};

  if (campaign.registrationLink && campaign.registrationLink.trim()) {
    // Custom Landing Page / Framer / Website
    const base = campaign.registrationLink.trim();
    const hasQuery = base.includes('?');
    const sep = hasQuery ? '&' : '?';
    for (const key of DEFAULT_SELECTED_CHANNELS) {
      result[key] = `${base}${sep}source=${key}&utm_source=${key}`;
    }
  } else if (campaign.zoomMeetingId && campaign.zoomLink?.includes('zoom.us')) {
    // Zoom Webinar Tracking Links
    const base = campaign.zoomLink.replace(/\?.*$/, '');
    for (const key of DEFAULT_SELECTED_CHANNELS) {
      result[key] = `${base}?source=${key}`;
    }
  } else {
    // Built-in 1-Click Magic Registration Mode
    for (const key of DEFAULT_SELECTED_CHANNELS) {
      result[key] = `${origin}/r/operator-preview?source=${key}`;
    }
  }

  return result as Record<RegistrationChannelKey, string>;
}
