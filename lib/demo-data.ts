// Placeholder data mirroring the original Claude Design mock's initial state.
// Milestone 2+ replaces this with real Prisma-backed data and live API calls.

export type CampaignStatus = 'live' | 'draft' | 'completed';

export interface Campaign {
  id: string;
  name: string;
  vertical: string;
  date: string;
  status: CampaignStatus;
  invites?: number;
  registrations?: number;
  attendance?: string;
  demoRequests?: number;
}

export const campaigns: Campaign[] = [
  { id: 'c1', name: 'Scaling High-Velocity Lending Ops with AI', vertical: 'Lending', date: 'Aug 28, 2026 · 3:00 PM IST', status: 'live', invites: 2140, registrations: 486 },
  { id: 'c2', name: 'Patient Journeys at Scale', vertical: 'Healthcare', date: 'Sep 9, 2026 · 11:00 AM IST', status: 'draft' },
  { id: 'c3', name: 'AI Underwriting in 2026', vertical: 'Lending', date: 'Jun 12, 2026', status: 'completed', invites: 1860, registrations: 402, attendance: '58%', demoRequests: 19 },
  { id: 'c4', name: 'Patient Journeys, Automated', vertical: 'Healthcare', date: 'May 5, 2026', status: 'completed', invites: 1420, registrations: 301, attendance: '64%', demoRequests: 14 },
  { id: 'c5', name: 'The Admissions Funnel, Rebuilt', vertical: 'Education', date: 'Mar 21, 2026', status: 'completed', invites: 980, registrations: 266, attendance: '55%', demoRequests: 9 },
];

export function getCampaign(id: string): Campaign {
  return campaigns.find((c) => c.id === id) ?? campaigns[0];
}

export const statusMeta: Record<CampaignStatus, { color: string; label: string }> = {
  live: { color: 'success', label: 'Live' },
  draft: { color: 'gray', label: 'Draft' },
  completed: { color: 'blue light', label: 'Completed' },
};

export const personaLearning = [
  { label: 'VP-level, Marketing', pct: 31 },
  { label: 'Director-level, Operations', pct: 24 },
  { label: 'Head of Admissions', pct: 27 },
  { label: 'IT Manager', pct: 9 },
];

export interface Contact {
  id: string;
  name: string;
  account: string;
  vertical: string;
  title: string;
  function: string;
  seniority: string;
  score: number;
  source: 'LinkedIn' | 'LinkedIn+Apollo' | 'Apollo';
  missingInfo: boolean;
  explanation: string;
}

export const contactsDemo: Contact[] = [
  { id: 'c1', name: 'Priya Nair', account: 'Acme Financial', vertical: 'Lending', title: 'VP Marketing', function: 'Marketing', seniority: 'VP', score: 92, source: 'LinkedIn', missingInfo: false, explanation: 'Senior marketing title + vertical match + verified email on file.' },
  { id: 'c2', name: 'Rohan Bhatt', account: 'Acme Financial', vertical: 'Lending', title: 'Head of Digital Lending', function: 'Product', seniority: 'Director', score: 88, source: 'LinkedIn+Apollo', missingInfo: false, explanation: 'Director+ seniority, product owner in lending — direct topic overlap.' },
  { id: 'c3', name: 'Ananya Rao', account: 'Northwind Health', vertical: 'Healthcare', title: 'Director, Patient Engagement', function: 'Operations', seniority: 'Director', score: 85, source: 'LinkedIn', missingInfo: false, explanation: 'Director-level operations lead, strong functional fit for AI ops topic.' },
  { id: 'c4', name: 'Karan Mehta', account: 'Northwind Health', vertical: 'Healthcare', title: 'IT Manager', function: 'IT', seniority: 'Manager', score: 61, source: 'Apollo', missingInfo: true, explanation: 'Manager-level IT role — lower seniority match, email unverified.' },
  { id: 'c5', name: 'Simran Kaur', account: 'Bright Ed Labs', vertical: 'Education', title: 'Head of Admissions', function: 'Admissions', seniority: 'Head', score: 90, source: 'LinkedIn', missingInfo: false, explanation: 'Head of function directly tied to the persona this webinar targets.' },
  { id: 'c6', name: 'Vikram Iyer', account: 'Meridian Manufacturing', vertical: 'Manufacturing', title: 'Plant Ops Director', function: 'Operations', seniority: 'Director', score: 78, source: 'LinkedIn', missingInfo: false, explanation: 'Director-level ops, moderate vertical distance from webinar topic.' },
  { id: 'c7', name: 'Ayesha Khan', account: 'Vertex Technologies', vertical: 'Technology', title: 'VP Growth Marketing', function: 'Marketing', seniority: 'VP', score: 95, source: 'LinkedIn', missingInfo: false, explanation: 'VP marketing, high engagement history, strongest overall match.' },
  { id: 'c8', name: 'Dev Malhotra', account: 'Vertex Technologies', vertical: 'Technology', title: 'Sales Enablement Lead', function: 'Sales', seniority: 'Lead', score: 82, source: 'Apollo', missingInfo: false, explanation: 'Lead-level sales role, good functional fit, verified via Apollo.' },
  { id: 'c9', name: 'Neha Kapoor', account: 'Cascade Realty Group', vertical: 'Real Estate', title: 'Marketing Manager', function: 'Marketing', seniority: 'Manager', score: 74, source: 'LinkedIn', missingInfo: true, explanation: 'Manager-level marketing — decent fit, missing verified phone/email.' },
];

export function scoreColor(score: number): string {
  if (score >= 85) return 'var(--success-700)';
  if (score >= 70) return 'var(--accent-500)';
  return 'var(--warning-700)';
}

export function sourceColor(source: Contact['source']): string {
  if (source === 'LinkedIn') return 'gray blue';
  if (source === 'LinkedIn+Apollo') return 'blue light';
  return 'gray';
}

export function initials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('');
}

export const activityLog = [
  { text: 'Parsed input file — 150 accounts, 150 LinkedIn IDs, 96 known emails detected', time: '09:14:02', dot: 'var(--success-500)' },
  { text: 'Cross-referencing LinkedIn profiles against title/function/seniority persona rules', time: '09:14:18', dot: 'var(--accent-500)' },
  { text: 'Enriching 54 accounts with no verified email via Apollo/Apify', time: '09:15:41', dot: 'var(--accent-500)' },
  { text: '2 LinkedIn company IDs unresolved — flagged for manual review', time: '09:15:52', dot: 'var(--warning-700)' },
  { text: 'Scoring 342 candidate contacts against webinar topic relevance', time: '09:16:30', dot: 'var(--accent-500)' },
];

export interface CadenceStep {
  id: string;
  group: string;
  title: string;
  timing: string;
  channel: string;
  channelColor: string;
  desc: string;
  toggleable: boolean;
  sent?: number;
  scheduled?: number;
  remaining?: number;
  failed?: number;
  isRoadmap?: boolean;
}

export const cadenceStepsData: CadenceStep[] = [
  { id: 'invite', group: 'Pre-registration', title: 'Initial invite', timing: 'Day 0', channel: 'Email', channelColor: 'blue', desc: "Personalized invite referencing the account's vertical and webinar value", toggleable: true, sent: 298, scheduled: 0, remaining: 0, failed: 2 },
  { id: 'linkedin', group: 'Pre-registration', title: 'LinkedIn touch task', timing: 'Day 1', channel: 'LinkedIn (assisted)', channelColor: 'gray blue', desc: 'Drafted comment/DM queued — one-click send, no automated posting', toggleable: true, sent: 140, scheduled: 158, remaining: 0, failed: 0 },
  { id: 'nudge', group: 'Pre-registration', title: 'Nudge', timing: '+4 days', channel: 'Email', channelColor: 'blue', desc: 'Second touch — social proof + reminder of registration link', toggleable: true, sent: 142, scheduled: 156, remaining: 0, failed: 0 },
  { id: 'final', group: 'Pre-registration', title: 'Final call', timing: '+7 days', channel: 'Email', channelColor: 'blue', desc: 'Last invite before cutoff, urgency framing', toggleable: true, sent: 60, scheduled: 238, remaining: 0, failed: 0 },
  { id: 'confirm', group: 'Reminders · registrants only', title: 'Registration confirmation', timing: 'Instant', channel: 'Email', channelColor: 'blue', desc: 'Fires the moment a bot-led sign-up completes', toggleable: true, sent: 486, scheduled: 0, remaining: 0, failed: 0 },
  { id: 't3', group: 'Reminders · registrants only', title: 'T-3 day reminder', timing: 'T-3d', channel: 'Email', channelColor: 'blue', desc: 'Calendar hold + what-to-expect', toggleable: true, sent: 0, scheduled: 486, remaining: 0, failed: 0 },
  { id: 't1d', group: 'Reminders · registrants only', title: 'T-1 day reminder', timing: 'T-1d', channel: 'Email + LinkedIn', channelColor: 'gray blue', desc: 'Cross-channel nudge, join link surfaced again', toggleable: true, sent: 0, scheduled: 486, remaining: 0, failed: 0 },
  { id: 't1h', group: 'Reminders · registrants only', title: 'T-1 hour reminder', timing: 'T-1h', channel: 'Email', channelColor: 'blue', desc: 'Final live-link push', toggleable: true, sent: 0, scheduled: 0, remaining: 486, failed: 0 },
  { id: 'attend', group: 'Post-webinar · within 2 hrs', title: 'Attendee follow-up', timing: '+0–2h', channel: 'Email', channelColor: 'blue', desc: 'Recording + next-step CTA', toggleable: true, sent: 0, scheduled: 0, remaining: 296, failed: 0 },
  { id: 'noshow', group: 'Post-webinar · within 2 hrs', title: 'No-show follow-up', timing: '+0–2h', channel: 'Email', channelColor: 'blue', desc: '"Sorry we missed you" + recording', toggleable: true, sent: 0, scheduled: 0, remaining: 190, failed: 0 },
  { id: 'whatsapp', group: 'Roadmap channels', title: 'WhatsApp cadence', timing: '—', channel: 'WhatsApp', channelColor: 'warning', desc: 'Same cadence engine, behind opt-in rollout', toggleable: false, isRoadmap: true },
  { id: 'sms', group: 'Roadmap channels', title: 'SMS cadence', timing: '—', channel: 'SMS', channelColor: 'warning', desc: 'Same cadence engine, behind opt-in rollout', toggleable: false, isRoadmap: true },
];

export const cadenceGroupOrder = ['Pre-registration', 'Reminders · registrants only', 'Post-webinar · within 2 hrs', 'Roadmap channels'];

export const accountBreakdownData = [
  { account: 'Acme Financial', persona: 'VP Marketing', invited: 2, registered: 2, watched: '38 min', action: 'Demo requested', actionColor: 'success' },
  { account: 'Northwind Health', persona: 'Dir. Patient Engagement', invited: 2, registered: 1, watched: '22 min', action: 'Nurture', actionColor: 'gray blue' },
  { account: 'Bright Ed Labs', persona: 'Head of Admissions', invited: 1, registered: 1, watched: '41 min', action: 'Demo requested', actionColor: 'success' },
  { account: 'Meridian Manufacturing', persona: 'Plant Ops Director', invited: 1, registered: 0, watched: '—', action: 'Re-engage', actionColor: 'warning' },
  { account: 'Vertex Technologies', persona: 'VP Growth Marketing', invited: 2, registered: 2, watched: '35 min', action: 'Demo requested', actionColor: 'success' },
  { account: 'Cascade Realty Group', persona: 'Marketing Manager', invited: 1, registered: 1, watched: '19 min', action: 'Nurture', actionColor: 'gray blue' },
];

export const integrationsData = [
  { id: 'lsq', name: 'LeadSquared', role: 'CRM + email sending', initial: 'L', avatarBg: 'var(--accent-500)', statusColor: 'success', statusLabel: 'Connected', lastOp: 'Synced engagement summary, 2 min ago', endpoint: 'POST /v2/LeadManagement.svc/Lead.CreateOrUpdate' },
  { id: 'zoom', name: 'Zoom', role: 'Webinar hosting', initial: 'Z', avatarBg: '#2563EB', statusColor: 'gray', statusLabel: 'No API — CSV import', lastOp: 'Attendance report imported, 40 min ago', endpoint: 'No API — participants report imported as CSV' },
  { id: 'claude', name: 'Claude', role: 'Propensity scoring, rewrites & chat', initial: 'C', avatarBg: 'var(--accent-purple)', statusColor: 'success', statusLabel: 'Connected', lastOp: 'Scored 342 contacts, today', endpoint: 'POST /v1/messages' },
  { id: 'apollo', name: 'Apollo', role: 'Contact enrichment', initial: 'A', avatarBg: '#7C3AED', statusColor: 'success', statusLabel: 'Connected', lastOp: 'Enriched contact details, today', endpoint: 'POST /v1/people/match' },
  { id: 'apify', name: 'Apify', role: 'Web + profile enrichment', initial: 'A', avatarBg: '#F97316', statusColor: 'error', statusLabel: 'Error', lastOp: 'Attempted enrichment, today', hasError: true, error: 'Rate limit exceeded on last batch — retry in 15 min.', endpoint: 'POST /v2/acts/lsq~linkedin-company/runs' },
  { id: 'linkedin', name: 'LinkedIn', role: 'Outreach — manual or bot', initial: 'in', avatarBg: '#0A66C2', statusColor: 'gray', statusLabel: 'Manual / simulated', lastOp: 'Drafted messages for the send queue, today', endpoint: 'No outreach API — manual send, or simulated bot batch' },
];

export interface Template {
  id: string;
  label: string;
  channel: string;
  channelColor: string;
  hasSubject: boolean;
  subject?: string;
  body: string;
}

export const templatesData: Template[] = [
  { id: 'invite', label: 'Initial invite', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: "You're invited: {{topic}}", body: 'Hi {{firstName}},\n\nJoin us for {{topic}} — a live session built for teams like {{company}}.\n\nRegister here: {{link}}\n\nSee you there.' },
  { id: 'nudge', label: 'Nudge (+4 days)', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: 'Still time to join {{topic}}', body: 'Hi {{firstName}},\n\nJust a reminder — {{topic}} is coming up. Spots are filling for {{company}} and similar teams.\n\nRegister: {{link}}' },
  { id: 'final', label: 'Final call (+7 days)', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: 'Last chance: {{topic}}', body: "Hi {{firstName}},\n\nRegistration for {{topic}} closes soon. Don't miss it.\n\n{{link}}" },
  { id: 'linkedin', label: 'LinkedIn touch', channel: 'LinkedIn', channelColor: 'gray blue', hasSubject: false, body: "Hi {{firstName}} — noticed {{company}}'s work in this space. We're running {{topic}} and thought it'd be relevant. Link if useful: {{link}}" },
  { id: 'attend', label: 'Attendee follow-up', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: 'Thanks for joining {{topic}}', body: "Hi {{firstName}},\n\nThanks for attending {{topic}}. Here's the recording plus a quick next step for {{company}}: {{link}}" },
  { id: 'noshow', label: 'No-show follow-up', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: 'Sorry we missed you at {{topic}}', body: "Hi {{firstName}},\n\nSorry we missed you at {{topic}}. Here's the recording so {{company}} doesn't miss out: {{link}}" },
  // t3/t1d/t1h are in AUTOMATED_STEP_KEYS (lib/cadence.ts) and get a CadenceStep
  // row from provisionCampaignDefaults — but until now had no Template row to
  // go with them. Every send for these three steps therefore permanently
  // failed with "Missing template or contact email" (see processSingleSend in
  // lib/cadence.ts), and no amount of retrying could ever succeed, because the
  // underlying cause was a missing template, not a transient send failure.
  { id: 't3', label: 'T-3 day reminder', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: "3 days to go: {{topic}}", body: "Hi {{firstName}},\n\n{{topic}} is coming up in 3 days. Save the time and get ready to join {{company}}'s peers.\n\nJoin link: {{link}}" },
  { id: 't1d', label: 'T-1 day reminder', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: "Tomorrow: {{topic}}", body: "Hi {{firstName}},\n\nJust a reminder — {{topic}} is tomorrow. We'll see you there.\n\nJoin link: {{link}}" },
  { id: 't1h', label: 'T-1 hour reminder', channel: 'Email', channelColor: 'blue', hasSubject: true, subject: "Starting soon: {{topic}}", body: "Hi {{firstName}},\n\n{{topic}} starts in about an hour. Here's your join link so you don't lose it: {{link}}" },
];

export const discoveryStats = [
  { label: 'Accounts processed', value: '150', sub: '6 shown below' },
  { label: 'Contacts identified', value: '342', sub: 'persona-matched' },
  { label: 'Verified emails', value: '318', sub: '93% coverage' },
  { label: 'Flagged for review', value: '9', sub: 'manual check needed' },
];

export const funnel = [
  { label: 'Imported', value: '150', pct: 100 },
  { label: 'Enriched', value: '144', pct: 96 },
  { label: 'Scored', value: '342', pct: 100 },
  { label: 'Approved', value: '304', pct: 89 },
  { label: 'Invited', value: '2,140', pct: 100 },
  { label: 'Clicked', value: '612', pct: 29 },
  { label: 'Registered', value: '486', pct: 23 },
  { label: 'Attended', value: '296', pct: 14 },
  { label: 'LSQ Synced', value: '486', pct: 23 },
];

export const stepBreakdown = [
  { label: 'Initial invite', count: 210, pct: 100 },
  { label: 'Nudge (+4d)', count: 142, pct: 68 },
  { label: 'LinkedIn touch', count: 74, pct: 35 },
  { label: 'Final call (+7d)', count: 60, pct: 29 },
];

export const breakdownData = {
  persona: [
    { label: 'VP Marketing', pct: 31, count: 106 },
    { label: 'Director Operations', pct: 24, count: 82 },
    { label: 'Head of Admissions', pct: 27, count: 92 },
    { label: 'IT Manager', pct: 9, count: 31 },
    { label: 'Sales / Enablement', pct: 9, count: 31 },
  ],
  scoreband: [
    { label: '90–100 (Excellent)', pct: 22, count: 75 },
    { label: '75–89 (Strong)', pct: 38, count: 130 },
    { label: '60–74 (Moderate)', pct: 29, count: 99 },
    { label: 'Below 60 (Low)', pct: 11, count: 38 },
  ],
  source: [
    { label: 'LinkedIn', pct: 52, count: 178 },
    { label: 'LinkedIn+Apollo', pct: 19, count: 65 },
    { label: 'Apollo', pct: 29, count: 99 },
  ],
};

export const needsAttention = [
  { id: 'na1', icon: 'ErrorProperty1Outline', color: 'error', title: 'Enrichment failed for 2 accounts', detail: 'LinkedIn company IDs did not resolve — retry with corrected IDs or skip.', actions: ['retry', 'skip'] },
  { id: 'na2', icon: 'ErrorProperty1Outline', color: 'error', title: 'Zoom registration failed for 4 contacts', detail: 'API rate limit hit during batch registration.', actions: ['retry', 'view'] },
  { id: 'na3', icon: 'InformationProperty1Outline', color: 'warning', title: 'Scoring config using defaults', detail: 'No custom criteria set — using the default persona-match heuristic.', actions: ['fix'] },
];

export const stageBadges: Record<string, { text: string; color: string }> = {
  setup: { text: 'Draft — not yet launched', color: 'gray' },
  scoring: { text: 'Scoring running', color: 'blue' },
  templates: { text: 'Templates in progress', color: 'blue' },
  personalize: { text: 'Personalizing outreach', color: 'blue' },
  schedule: { text: 'Ready to launch', color: 'blue' },
  control: { text: 'Cadence live', color: 'success' },
  dashboard: { text: 'Post-event complete', color: 'success' },
};

export const workspaceTabs = [
  { id: 'setup', label: 'Setup', n: 1 },
  { id: 'scoring', label: 'Scoring', n: 2 },
  { id: 'templates', label: 'Templates', n: 3 },
  { id: 'personalize', label: 'Personalize', n: 4 },
  { id: 'schedule', label: 'Schedule', n: 5 },
  { id: 'control', label: 'Control Center', n: 6 },
  { id: 'dashboard', label: 'Dashboard', n: 7 },
];
