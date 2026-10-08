/**
 * Zoom URL & Webinar ID Parser
 * Handles extraction of unique Zoom Webinar / Meeting IDs and registration slugs
 * from diverse URL formats and raw inputs.
 */

export interface ParsedZoomResult {
  raw: string;
  zoomId: string | null;           // 9 to 11 digit numeric ID: e.g. "84920491823"
  webinarId: string | null;        // Primary ID: zoomId or registrationSlug
  registrationSlug: string | null; // e.g. "WN_k8S9-2JjT82XbQ19Abcdef"
  kind: 'webinar' | 'meeting' | 'registration_page' | 'raw_id' | 'unknown';
  type: 'webinar' | 'meeting' | 'registration_page' | 'raw_id' | 'unknown';
  isRegistration: boolean;
  canonicalJoinUrl: string;
  normalizedUrl: string;
  sourceTrackingBaseUrl: string;
  isValid: boolean;
}

/**
 * Parses any Zoom input string (registration URL, join link, raw ID, etc.)
 * and extracts the unique Zoom ID and registration slug.
 */
export function parseZoomInput(input?: string | null): ParsedZoomResult {
  const clean = (input || '').trim();
  if (!clean) {
    return {
      raw: '',
      zoomId: null,
      webinarId: null,
      registrationSlug: null,
      kind: 'unknown',
      type: 'unknown',
      isRegistration: false,
      canonicalJoinUrl: '',
      normalizedUrl: '',
      sourceTrackingBaseUrl: '',
      isValid: false,
    };
  }

  // 1. Extract 9 to 11 digit numeric meeting or webinar ID
  // Removes spaces and hyphens commonly used in user-formatted Zoom IDs (e.g. "849 2049 1823")
  const numericMatch = clean.replace(/[\s-]/g, '').match(/\b\d{9,11}\b/);
  const zoomId = numericMatch ? numericMatch[0] : null;

  // 2. Extract WN_ registration token/slug
  // Format: "WN_" followed by alphanumeric, hyphens, and underscores
  const regMatch = clean.match(/WN_[A-Za-z0-9_-]+/);
  const registrationSlug = regMatch ? regMatch[0] : null;

  // 3. Determine event kind
  const isWebinarUrl = clean.includes('/w/') || clean.includes('/webinar/') || clean.includes('webinar');
  const isMeetingUrl = clean.includes('/j/') || clean.includes('/meeting/') || clean.includes('/s/');
  const isPureDigits = /^\d{9,11}$/.test(clean.replace(/[\s-]/g, ''));

  let kind: ParsedZoomResult['kind'] = 'unknown';
  if (registrationSlug) {
    kind = 'registration_page';
  } else if (isPureDigits) {
    kind = 'raw_id';
  } else if (isWebinarUrl) {
    kind = 'webinar';
  } else if (isMeetingUrl) {
    kind = 'meeting';
  } else if (zoomId) {
    kind = 'meeting';
  }

  // 4. Construct canonical join URL
  let canonicalJoinUrl = clean;
  if (registrationSlug && !clean.startsWith('http://') && !clean.startsWith('https://')) {
    canonicalJoinUrl = `https://zoom.us/webinar/register/${registrationSlug}`;
  } else if (zoomId) {
    const isW = kind === 'webinar' || kind === 'registration_page';
    canonicalJoinUrl = `https://zoom.us/${isW ? 'w' : 'j'}/${zoomId}`;
  } else if (clean.startsWith('http://') || clean.startsWith('https://')) {
    canonicalJoinUrl = clean;
  } else if (clean) {
    canonicalJoinUrl = `https://${clean}`;
  }

  // 5. Construct base registration / tracking URL for source segregation
  let sourceTrackingBaseUrl = canonicalJoinUrl;
  if (registrationSlug) {
    sourceTrackingBaseUrl = `https://zoom.us/webinar/register/${registrationSlug}`;
  } else if (zoomId && (kind === 'webinar' || isWebinarUrl)) {
    sourceTrackingBaseUrl = `https://zoom.us/webinar/register/${zoomId}`;
  }

  const isValid = !!(zoomId || registrationSlug || clean.includes('zoom.us'));

  return {
    raw: clean,
    zoomId,
    webinarId: zoomId || registrationSlug || null,
    registrationSlug,
    kind,
    type: kind,
    isRegistration: Boolean(registrationSlug || isWebinarUrl || clean.includes('/meeting/register/')),
    canonicalJoinUrl,
    normalizedUrl: canonicalJoinUrl,
    sourceTrackingBaseUrl,
    isValid,
  };
}

/**
 * Builds Zoom-native tracking URLs for the specified channels when using Zoom's
 * hosted registration page.
 */
export function buildZoomNativeChannelLinks(
  parsed: ParsedZoomResult,
  channelKeys: string[] = ['email_campaign', 'sms', 'whatsapp', 'linkedin', 'sdr_sales', 'third_parties', 'linkedin_event', 'website']
): Record<string, string> {
  const links: Record<string, string> = {};
  const base = parsed.sourceTrackingBaseUrl.replace(/\?.*$/, '');

  for (const ch of channelKeys) {
    links[ch] = `${base}?source=${ch}`;
  }

  return links;
}
