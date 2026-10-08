export const KNOWN_MERGE_VARS = [
  'firstName',
  'lastName',
  'company',
  'account',
  'topic',
  'webinarTitle',
  'title',
  'link',
  'zoomLink',
  'registrationLink',
  'date',
  'dateTime',
  'speaker',
  'speakerName',
  'speakerTitle',
  'speakers',
];

export interface MergeFieldOptions {
  firstName: string;
  lastName?: string;
  company: string;
  topic: string;
  webinarTitle?: string;
  link: string;
  zoomLink?: string;
  registrationLink?: string;
  date?: string;
  dateTime?: string;
  speaker?: string;
  speakerName?: string;
  speakerTitle?: string;
  speakers?: string;
}

export function renderMergeFields(str: string, opts: MergeFieldOptions): string {
  if (!str) return '';
  const cleanLink = opts.link || opts.zoomLink || opts.registrationLink || '#';
  const cleanTopic = opts.webinarTitle || opts.topic || 'our upcoming webinar';
  const cleanSpeaker = opts.speakers || opts.speaker || opts.speakerName || 'our featured speaker';

  // Every token is resolved once, up front, then substituted in a single
  // regex pass. Chaining separate .replace() calls here previously let one
  // contact's own field value (e.g. a firstName that literally contains
  // "{{company}}", plausible from a public registration form) get re-scanned
  // and re-substituted by a later .replace() in the chain — splicing the
  // wrong contact's data into the message with nothing for the downstream
  // leftover-token validator to catch, since the result had no braces left.
  // A single-pass replace can't do that: String.replace(/g) matches against
  // the original string only, never against already-substituted text.
  const cleanString = (val: string | undefined | null, fallback = ''): string => {
    if (!val) return fallback;
    const trimmed = val.trim();
    if (trimmed === '—' || trimmed === '-' || trimmed.toLowerCase() === 'n/a' || trimmed.toLowerCase() === 'unknown') {
      return fallback;
    }
    return trimmed;
  };

  const cleanCompany = cleanString(opts.company, 'your team');
  const cleanFirstName = cleanString(opts.firstName, 'there');

  const values: Record<string, string> = {
    firstname: cleanFirstName,
    lastname: cleanString(opts.lastName, ''),
    company: cleanCompany,
    account: cleanCompany,
    webinartitle: opts.webinarTitle || opts.topic || cleanTopic,
    topic: opts.topic || opts.webinarTitle || cleanTopic,
    title: opts.topic || opts.webinarTitle || cleanTopic,
    zoomlink: opts.zoomLink || cleanLink,
    registrationlink: opts.registrationLink || cleanLink,
    link: cleanLink,
    datetime: opts.dateTime ?? opts.date ?? '',
    date: opts.date ?? opts.dateTime ?? '',
    speakername: opts.speakerName || opts.speaker || cleanSpeaker,
    speaker: opts.speaker || opts.speakerName || cleanSpeaker,
    speakertitle: opts.speakerTitle ?? '',
    speakers: cleanSpeaker,
  };

  // Case-insensitive on the token name itself (e.g. {{FirstName}}) — the
  // chained version required an exact-case match per branch, so any
  // mis-cased token silently shipped as literal "{{FirstName}}" text.
  return str.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (match, key: string) => {
    const resolved = values[key.toLowerCase()];
    return resolved !== undefined ? resolved : match;
  });
}
