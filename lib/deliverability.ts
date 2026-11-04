// What is likely to keep an invite from reaching an inbox even though the sending service accepts it. Nothing here is
// shown on a screen or blocks anything: Studio writes it to the server log when a cadence launches, so the cause is
// there when someone asks why a message never arrived. See docs/EMAIL_DELIVERABILITY.md.

import { appOrigin } from '@/lib/appOrigin';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import { registrationModeOf } from '@/lib/inviteLink';
import { classifyHost, hostOf, isBetterHost, type HostClass } from '@/lib/linkHost';
import { sharesOrganization } from '@/lib/senderDomain';

export interface DeliverabilityInput {
  /** Studio's own public address. */
  appOrigin: string;
  mode: 'zoom' | 'external';
  landingUrl?: string | null;
  fromEmail?: string | null;
  recipientEmails: Array<string | null | undefined>;
}

const WHY: Record<Exclude<HostClass, 'own'>, string> = {
  shared: 'a free address that comes with a page builder or host, shared with thousands of other sites',
  temporary: 'a temporary or local address that works for a test only',
};

/** The address a message will show for a link to register: the landing page, or Studio's own when that is the better one. */
export function shownLinkAddress(input: Pick<DeliverabilityInput, 'appOrigin' | 'mode' | 'landingUrl'>): string {
  if (input.mode !== 'external' || !input.landingUrl) return input.appOrigin;
  return isBetterHost(input.appOrigin, input.landingUrl) ? input.appOrigin : input.landingUrl;
}

export function deliverabilityNotes(input: DeliverabilityInput): string[] {
  const notes: string[] = [];

  const shown = shownLinkAddress(input);
  const cls = classifyHost(shown);
  if (cls !== 'own') {
    notes.push(
      `Invite links will show ${hostOf(shown) || 'no usable address'}, ${WHY[cls]}. Mail filters often hold messages with links like this. ` +
        'Put the landing page on your own domain and run Studio on its own domain before a real send.',
    );
  }

  const sameCompany = input.recipientEmails.filter((email) => sharesOrganization(input.fromEmail, email)).length;
  if (sameCompany > 0) {
    notes.push(
      `${sameCompany} recipient${sameCompany === 1 ? ' is' : 's are'} at the same company as the sender (${input.fromEmail}). That company's own mail ` +
        'system may hold or flag these messages even though the sending service accepted them. Allow the sending domain there, and test with an outside address too.',
    );
  }
  return notes;
}

/** Logs the notes for a launching campaign. Best effort: a note must never get in the way of a launch. */
export async function logDeliverabilityNotes(
  campaign: { id: string; registrationMode?: string | null; registrationLink?: string | null; oneClickSignup?: boolean | null },
  approvedContacts: Array<{ email?: string | null }>,
): Promise<string[]> {
  try {
    const fromEmail = ((await resolveIntegrationField('netcore', 'fromEmail')) || process.env.NETCORE_FROM_EMAIL || '').trim();
    const notes = deliverabilityNotes({
      appOrigin: appOrigin(),
      mode: registrationModeOf(campaign),
      landingUrl: campaign.registrationLink,
      fromEmail,
      recipientEmails: approvedContacts.map((c) => c.email),
    });
    for (const note of notes) console.warn(`[deliverability] campaign ${campaign.id}: ${note}`);
    return notes;
  } catch {
    return [];
  }
}
