// Pure. Turns a webinar's registration setup into a plain-language readiness checklist. This is what
// the Launch gate, the setup checklist and the "Send test registration" dry run all show — one set of
// rules, so the UI can never say "ready" while something is broken (audit F-2: the old banner always
// said "pre-flight verified").

import { registrationModeOf, buildInviteLink, type RegistrationMode } from '@/lib/inviteLink';
import { verifyRegistrationToken } from '@/lib/registration';
import { registrationAvailability } from '@/lib/registrationAvailability';
import type { LandingReport } from '@/lib/landingVerify';

export type ReadinessStatus = 'pass' | 'warn' | 'fail';
export interface ReadinessCheck {
  id: string;
  group: 'event' | 'registration' | 'zoom' | 'crm';
  label: string;
  status: ReadinessStatus;
  detail: string;
  fix?: string;
}

export interface ReadinessInput {
  campaign: {
    id: string;
    name?: string | null;
    status?: string | null;
    archived?: boolean | null;
    scheduledAt?: Date | null;
    durationMinutes?: number | null;
    capacity?: number | null;
    registrations?: number | null;
    registrationMode?: string | null;
    registrationLink?: string | null;
    oneClickSignup?: boolean | null;
    landingPrefill?: boolean | null;
    zoomLink?: string | null;
    zoomMeetingId?: string | null;
    zoomEventType?: string | null;
    lsqSuppressionListId?: string | null;
  };
  appOrigin: string;
  zoom: {
    connected: boolean;
    /** From getZoomRegistrationHealthAction; null when no event is linked. */
    health: { registrationEnabled: boolean; error?: string; kind: 'meeting' | 'webinar' } | null;
    webhookSecretSet: boolean;
  };
  lsqConfigured: boolean;
  landing?: LandingReport | null;
  now?: Date;
}

export interface Readiness {
  mode: RegistrationMode;
  checks: ReadinessCheck[];
  ready: boolean;
  counts: Record<ReadinessStatus, number>;
}

const isPublicOrigin = (o: string) => /^https:\/\//i.test(o) && !/localhost|127\.0\.0\.1|\.local\b|\b10\.|192\.168\./i.test(o);

export function computeRegistrationReadiness(input: ReadinessInput): Readiness {
  const { campaign: c, appOrigin, zoom, lsqConfigured, landing } = input;
  const now = input.now ?? new Date();
  const mode = registrationModeOf(c);
  const checks: ReadinessCheck[] = [];
  const add = (x: ReadinessCheck) => checks.push(x);

  // ── event ──
  if (!c.scheduledAt) {
    add({ id: 'date', group: 'event', label: 'Date and time', status: 'fail', detail: 'No date or time is set.', fix: 'Set the webinar date and time.' });
  } else if (c.scheduledAt.getTime() < now.getTime()) {
    add({ id: 'date', group: 'event', label: 'Date and time', status: 'warn', detail: 'The webinar date has already passed. Invites and reminders scheduled around it will not send.', fix: 'Move the webinar to a future date, or archive it.' });
  } else {
    add({ id: 'date', group: 'event', label: 'Date and time', status: 'pass', detail: 'The webinar is scheduled for a future time.' });
  }

  const avail = registrationAvailability(c, now);
  add(
    avail.open
      ? { id: 'open', group: 'event', label: 'Registration is open', status: 'pass', detail: 'People can register right now.' }
      : { id: 'open', group: 'event', label: 'Registration is open', status: 'fail', detail: `Registration is closed (${avail.reason}).`, fix: avail.reason === 'full' ? 'Raise the capacity or end registration deliberately.' : 'Registration cannot be reopened for a webinar that has ended.' }
  );

  // ── registration page ──
  add(
    isPublicOrigin(appOrigin)
      ? { id: 'origin', group: 'registration', label: 'Public address', status: 'pass', detail: `Invite links use ${appOrigin}.` }
      : { id: 'origin', group: 'registration', label: 'Public address', status: 'warn', detail: `Invite links point at ${appOrigin || 'an unset address'}, which attendees cannot open.`, fix: 'Set APP_ORIGIN to the public https address of this app (a tunnel is fine for testing).' }
  );

  if (mode === 'external') {
    const url = (c.registrationLink ?? '').trim();
    add(url ? { id: 'landing-url', group: 'registration', label: 'Landing page address', status: 'pass', detail: url } : { id: 'landing-url', group: 'registration', label: 'Landing page address', status: 'fail', detail: 'External landing page mode needs an address.', fix: 'Enter the landing page URL.' });
    if (landing) {
      const failing = landing.checks.filter((k) => k.status === 'fail');
      const warning = landing.checks.filter((k) => k.status === 'warn');
      add(
        landing.overall === 'pass'
          ? { id: 'landing-verify', group: 'registration', label: 'Landing page check', status: 'pass', detail: 'The page loads and can register people into Studio.' }
          : { id: 'landing-verify', group: 'registration', label: 'Landing page check', status: landing.overall, detail: [...failing, ...warning].map((k) => k.detail).join(' '), fix: [...failing, ...warning].map((k) => k.fix).filter(Boolean).join(' ') }
      );
    } else if (url) {
      add({ id: 'landing-verify', group: 'registration', label: 'Landing page check', status: 'warn', detail: 'The landing page has not been checked yet.', fix: 'Run "Check landing page" to confirm it can register people.' });
    }
  } else {
    // Mint a link for a sample contact and prove it round-trips through the verifier.
    const link = buildInviteLink({ campaign: c, contact: { id: 'sample-contact', registeredAt: null }, channel: 'email', appOrigin });
    let tokenOk = false;
    try {
      const u = new URL(link);
      const tok = u.pathname.startsWith('/r/') ? u.pathname.split('/')[2] : u.searchParams.get('t');
      tokenOk = Boolean(tok && verifyRegistrationToken(tok).ok);
    } catch {
      tokenOk = false;
    }
    add(
      tokenOk
        ? { id: 'invite-link', group: 'registration', label: 'Invite links', status: 'pass', detail: c.oneClickSignup === false ? 'Invites link to the hosted registration form.' : 'Invites carry a one-click signed link.' }
        : { id: 'invite-link', group: 'registration', label: 'Invite links', status: 'fail', detail: 'Studio could not generate a valid invite link.', fix: 'Check APP_ORIGIN and REGISTRATION_SECRET.' }
    );
  }

  // ── zoom ──
  if (!c.zoomMeetingId) {
    add({ id: 'zoom-link', group: 'zoom', label: 'Zoom event', status: 'warn', detail: 'No Zoom event is linked. Registrations are recorded in Studio, but attendees get no personal join link and attendance cannot be imported.', fix: 'Link or create a Zoom event.' });
  } else if (!zoom.connected) {
    add({ id: 'zoom-connected', group: 'zoom', label: 'Zoom connection', status: 'fail', detail: 'A Zoom event is linked but Zoom is not connected, so registrants cannot be created.', fix: 'Connect Zoom on the Integrations page.' });
  } else if (!zoom.health) {
    add({ id: 'zoom-health', group: 'zoom', label: 'Zoom registration', status: 'warn', detail: 'The Zoom event could not be checked.', fix: 'Reload and try again.' });
  } else if (zoom.health.error) {
    add({ id: 'zoom-health', group: 'zoom', label: 'Zoom registration', status: 'warn', detail: zoom.health.error, fix: 'Check the Zoom connection and that the event still exists.' });
  } else if (!zoom.health.registrationEnabled) {
    add({ id: 'zoom-registration', group: 'zoom', label: 'Zoom registration', status: 'fail', detail: 'Registration is switched off on the Zoom event, so every add-registrant call will be refused.', fix: 'Use "Enable registration" (needs the update scope and a Licensed host).' });
  } else {
    add({ id: 'zoom-registration', group: 'zoom', label: 'Zoom registration', status: 'pass', detail: `Registration is enabled on the Zoom ${zoom.health.kind}.` });
  }
  if (c.zoomMeetingId) {
    add(
      zoom.webhookSecretSet
        ? { id: 'zoom-webhook', group: 'zoom', label: 'Zoom webhook secret', status: 'pass', detail: 'Zoom events (registrations, meeting ended) will be accepted.' }
        : { id: 'zoom-webhook', group: 'zoom', label: 'Zoom webhook secret', status: 'warn', detail: 'No webhook secret token is set, so Zoom events are rejected. Attendance is then only imported by the slower fallback.', fix: 'Add the Secret Token from the Zoom app (Event Subscriptions).' }
    );
    if (c.zoomEventType !== 'webinar' && (c.capacity ?? 0) > 4999) {
      add({ id: 'zoom-cap', group: 'zoom', label: 'Zoom capacity', status: 'warn', detail: 'A Zoom meeting accepts at most 4,999 registrants but the capacity is higher.', fix: 'Use a Zoom webinar (add-on) or lower the capacity.' });
    }
  }

  // ── crm ──
  add(
    lsqConfigured
      ? { id: 'lsq', group: 'crm', label: 'LeadSquared', status: 'pass', detail: 'Registrations are written to LeadSquared.' }
      : { id: 'lsq', group: 'crm', label: 'LeadSquared', status: 'warn', detail: 'LeadSquared is not connected, so registrations will not appear in the CRM.', fix: 'Connect LeadSquared on the Integrations page.' }
  );

  // People who register must stop receiving invites everywhere. This app cancels its own pending sends; the
  // LeadSquared suppression list is what keeps the CRM's own automations from emailing them too, and without
  // a chosen list the sync is skipped silently.
  if (lsqConfigured) {
    add(
      c.lsqSuppressionListId
        ? { id: 'suppression', group: 'crm', label: 'Suppression list', status: 'pass', detail: 'People who register are added to the chosen LeadSquared suppression list.' }
        : {
            id: 'suppression',
            group: 'crm',
            label: 'Suppression list',
            status: 'warn',
            detail: 'No LeadSquared suppression list is chosen, so people who register are not added to one. Invites sent from this app still stop, but LeadSquared automations may keep emailing them.',
            fix: 'Choose a suppression list under Exclusions on the Cadence tab.',
          }
    );
  }

  const counts = { pass: 0, warn: 0, fail: 0 } as Record<ReadinessStatus, number>;
  for (const k of checks) counts[k.status]++;
  return { mode, checks, ready: counts.fail === 0, counts };
}
