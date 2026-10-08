'use server';

import { db } from '@/lib/db';
import { getLists, getLeadsInList, type RawLsqLead } from '@/lib/leadsquared';
import { classifyContact, pickCol, functionFor, seniorityFor } from '@/lib/importHeuristics';
import { syncContactsToLeadSquared } from '@/lib/leadSync';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';
import { parseCsvText } from '@/lib/csv';
import { applyOffset } from '@/lib/stepSchedule';
import { normalizeE164 } from '@/lib/csvPreflight';
import { syncSpeakersForCampaign } from '@/lib/speakersServer';
import type { SpeakerInput } from '@/lib/speakers';
import { resolveIntegrationField } from '@/lib/integrationConfig';
import type { LsqList } from '@/lib/leadsquared';
import {
  serializeSelectedChannels,
  type RegistrationChannelKey,
} from '@/lib/registrationChannels';
import { assertSetupEditable, setupLockError } from '@/lib/setupLock';
import { wallClockToDate, DEFAULT_TIMEZONE } from '@/lib/dateFormat';
import { z } from 'zod';


const campaignIdSchema = z.string().min(1);

// A malformed shape (wrong types, not an array) used to reach syncSpeakersForCampaign
// unchecked and throw an uncaught TypeError from inside its transaction. Length caps
// exist because the bio gets re-embedded into every AI personalization batch (see
// lib/claude.ts's webinarGuidance and its per-batch campaign JSON) — an unbounded
// paste there multiplies into a real token-cost and context-window risk across an
// entire campaign's worth of batches, not just one contact.
const speakerInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(200),
  title: z.string().trim().max(200).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  bio: z.string().trim().max(600, 'Bio is limited to 600 characters').nullable().optional(),
  avatarUrl: z.string().trim().max(2000).nullable().optional(),
  linkedinUrl: z.string().trim().max(2000).nullable().optional(),
  isPrimary: z.boolean().optional(),
  order: z.number().int().optional(),
});
const speakersSchema = z.array(speakerInputSchema).max(20, 'A campaign supports at most 20 speakers');

export async function updateCampaignSpeakersAction(campaignId: string, speakers: SpeakerInput[]) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validSpeakers = speakersSchema.parse(speakers);
  await syncSpeakersForCampaign(validCampaignId, validSpeakers);
  await db.activityLogEntry.create({
    data: { campaignId: validCampaignId, text: 'Speakers updated', dot: 'var(--accent-500)' },
  });
  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignName(campaignId: string, name: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.campaign.update({ where: { id: validCampaignId }, data: { name } });
  revalidateCampaign(validCampaignId);
}

/** What editing the webinar's core details would clear — computed so the
 *  confirmation dialog can name real numbers instead of a generic warning. */
export interface SetupEditImpact {
  scoredCount: number;
  approvedCount: number;
  personalizedCount: number;
  cadenceSendCount: number;
}

export async function getSetupEditImpactAction(campaignId: string): Promise<SetupEditImpact> {
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const [scoredCount, approvedCount, personalizedCount, cadenceSendCount] = await Promise.all([
    db.contact.count({ where: { campaignId: validCampaignId, score: { not: null } } }),
    db.contact.count({ where: { campaignId: validCampaignId, approved: true } }),
    db.personalizedMessage.count({ where: { campaignId: validCampaignId } }),
    db.cadenceSend.count({ where: { campaignId: validCampaignId } }),
  ]);
  return { scoredCount, approvedCount, personalizedCount, cadenceSendCount };
}

/**
 * Editing the webinar's topic, date or Zoom event after real audience work
 * has happened invalidates that work — Claude scored/wrote copy against the
 * old details, and cadence timing was computed from the old date. Rather
 * than leave stale scores, drafts and queued sends sitting around looking
 * current, editing clears them — but the imported contact *list* (name,
 * email, company, title, enrichment...) is never touched, since re-importing
 * a CSV is the expensive step to avoid repeating.
 */
export async function resetCampaignForEditAction(campaignId: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.$transaction([
    db.contact.updateMany({ where: { campaignId: validCampaignId }, data: { score: null, explanation: null, approved: false, approvedManually: false } }),
    db.personalizedMessage.deleteMany({ where: { campaignId: validCampaignId } }),
    db.cadenceSend.deleteMany({ where: { campaignId: validCampaignId } }),
    db.campaign.update({ where: { id: validCampaignId }, data: { cadenceStatus: 'not_started', launchedAt: null } }),
  ]);
  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignDescription(campaignId: string, description: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.campaign.update({ where: { id: validCampaignId }, data: { description } });
  revalidateCampaign(validCampaignId);
}

const ZOOM_HOSTS = /(^|\.)(zoom\.us|zoomgov\.com)$/i;

/**
 * Stores the event link. Zoom URLs are the expected case but any https link is
 * accepted — plenty of teams run these on Teams, Meet, or their own page — so the
 * check reports what it recognised instead of blocking.
 */
export async function updateCampaignZoomLink(campaignId: string, zoomLink: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const trimmed = zoomLink.trim();
  if (!trimmed) {
    await db.campaign.update({ where: { id: validCampaignId }, data: { zoomLink: null } });
    revalidateCampaign(validCampaignId);
    return { ok: true as const, kind: 'empty' as const };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false as const, error: 'That does not look like a full URL — include https://' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false as const, error: 'Only http(s) links are supported.' };
  }

  await db.campaign.update({ where: { id: validCampaignId }, data: { zoomLink: trimmed } });
  revalidateCampaign(validCampaignId);
  return { ok: true as const, kind: ZOOM_HOSTS.test(parsed.hostname) ? ('zoom' as const) : ('other' as const), host: parsed.hostname };
}

/**
 * The registration link input on Setup was rendered `readOnly` with no save
 * handler at all — there was no code path that could ever write a pasted
 * value back to the campaign. This is the actual handler for that field.
 * Loosely validated (bot-led sign-up appends its own query params, and teams
 * may use a bare "lsq.co/w/slug" short-link rather than a full URL), so this
 * only rejects empty/whitespace input, not anything that isn't a strict URL.
 */
export async function updateCampaignRegistrationLink(campaignId: string, link: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const trimmed = link.trim();
  if (!trimmed) return { ok: false as const, error: 'The registration link cannot be empty — contacts need somewhere to sign up.' };

  await db.campaign.update({ where: { id: validCampaignId }, data: { registrationLink: trimmed } });
  await db.activityLogEntry.create({
    data: { campaignId: validCampaignId, text: `Registration link updated to ${trimmed}`, dot: 'var(--accent-500)' },
  });
  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignRegistrationFunnelAction(
  campaignId: string,
  params: {
    registrationLink?: string | null;
    oneClickSignup?: boolean;
    zoomMeetingId?: string | null;
    zoomLink?: string | null;
  }
) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const trimmed = params.registrationLink ? params.registrationLink.trim() : null;
  const oneClickSignup = params.oneClickSignup !== undefined ? Boolean(params.oneClickSignup) : true;

  const updateData: {
    registrationLink: string | null;
    oneClickSignup: boolean;
    zoomMeetingId?: string | null;
    zoomLink?: string | null;
  } = {
    registrationLink: trimmed || null,
    oneClickSignup,
  };

  if (params.zoomMeetingId !== undefined) {
    updateData.zoomMeetingId = params.zoomMeetingId ? params.zoomMeetingId.trim() : null;
  }
  if (params.zoomLink !== undefined) {
    updateData.zoomLink = params.zoomLink ? params.zoomLink.trim() : null;
  }

  await db.campaign.update({
    where: { id: validCampaignId },
    data: updateData,
  });

  const modeText = trimmed ? `External Landing Page: ${trimmed}` : '1-Click Magic Link';
  const zoomText = params.zoomMeetingId ? ` (Zoom ID #${params.zoomMeetingId})` : '';
  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Registration funnel updated: ${modeText}${zoomText}`,
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignEmailProviderAction(campaignId: string, emailProvider: 'leadsquared' | 'netcore') {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  if (emailProvider !== 'leadsquared' && emailProvider !== 'netcore') {
    return { ok: false as const, error: 'Invalid email provider.' };
  }

  await db.campaign.update({
    where: { id: validCampaignId },
    data: { emailProvider },
  });

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Email delivery gateway switched to ${emailProvider === 'netcore' ? 'Netcore Cloud' : 'LeadSquared'}`,
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignCapacityAction(campaignId: string, capacity: number | null) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const validCapacity = capacity === null || capacity === undefined ? null : z.number().int().min(1).max(100000).parse(capacity);

  await db.campaign.update({
    where: { id: validCampaignId },
    data: { capacity: validCapacity },
  });

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: validCapacity ? `Webinar capacity set to ${validCapacity} seats` : 'Webinar capacity limit removed',
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

export async function updateCampaignSelectedChannelsAction(
  campaignId: string,
  channels: RegistrationChannelKey[]
) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  const serialized = serializeSelectedChannels(channels);
  // Channel attribution is tracked by Studio itself (signed per-channel links + UTMs). Zoom has no
  // API to create registration tracking sources (POST /webinars/{id}/tracking_sources is a 404), so
  // there is nothing to push to Zoom here.
  await db.campaign.update({
    where: { id: validCampaignId },
    data: { selectedChannels: serialized },
  });

  await db.activityLogEntry.create({
    data: {
      campaignId: validCampaignId,
      text: `Active attribution channels updated (${channels.length} channels selected)`,
      dot: 'var(--accent-500)',
    },
  });

  revalidateCampaign(validCampaignId);
  return { ok: true as const };
}

/**
 * Takes a datetime-local value ("2026-08-28T15:00") and stores both forms.
 * This is the *only* place `scheduledAt` is ever written — keep it that way.
 * `date` (display string) and `scheduledAt` (real timestamp) only stay in sync
 * because every write happens here, together, in one call; a second write site
 * for `scheduledAt` that forgot to also set `date` would silently desync them.
 * Historical/seeded campaigns (see prisma/seed.ts) predate this picker and can
 * hold a `date` string with no `scheduledAt` at all — that's expected for them,
 * not drift.
 */
export async function updateCampaignSchedule(campaignId: string, dateTimeLocal: string) {
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  if (!dateTimeLocal) {
    await db.campaign.update({ where: { id: validCampaignId }, data: { scheduledAt: null, date: 'Not scheduled yet' } });
    revalidateCampaign(validCampaignId);
    return { ok: true as const, display: 'Not scheduled yet' };
  }

  const zoneRow = await db.campaign.findUnique({ where: { id: validCampaignId }, select: { timezone: true } });
  const timezone = zoneRow?.timezone ?? DEFAULT_TIMEZONE;
  // The picker value is wall-clock time in the webinar's zone, not the server's.
  const parsed = wallClockToDate(dateTimeLocal, timezone);
  if (!parsed) return { ok: false as const, error: 'That date could not be read.' };

  const display = formatWebinarDate(parsed, timezone);
  await db.campaign.update({ where: { id: validCampaignId }, data: { scheduledAt: parsed, date: display } });

  // Rescheduling anchor synchronization: update dueAt for all queued sends anchored to the webinar
  const webinarSteps = await db.cadenceStep.findMany({
    where: { campaignId: validCampaignId, anchor: 'webinar' },
    select: { key: true, offsetValue: true, offsetUnit: true },
  });
  for (const s of webinarSteps) {
    const newDue = applyOffset(parsed, s.offsetValue, s.offsetUnit);
    await db.cadenceSend.updateMany({
      where: { campaignId: validCampaignId, stepKey: s.key, status: 'queued' },
      data: { dueAt: newDue },
    });
  }

  revalidateCampaign(validCampaignId);
  return { ok: true as const, display };
}

async function upsertContacts(campaignId: string, rows: (ReturnType<typeof classifyContact> & { lsqLeadId?: string })[]) {
  if (rows.length === 0) return;

  const existingContacts = await db.contact.findMany({
    where: { campaignId },
  });

  const existingByEmail = new Map<string, typeof existingContacts[number]>();
  const existingByNameAccount = new Map<string, typeof existingContacts[number]>();

  for (const c of existingContacts) {
    if (c.email) existingByEmail.set(c.email.trim().toLowerCase(), c);
    existingByNameAccount.set(`${c.name.trim()}|${c.account.trim()}`.toLowerCase(), c);
  }

  const toCreate: Array<{
    campaignId: string;
    name: string;
    email: string | null;
    account: string;
    vertical: string;
    title: string;
    function: string;
    seniority: string;
    linkedinId: string | null;
    phone: string | null;
    whatsappOptIn: boolean;
    smsOptOut: boolean;
    extraFieldsJson: string | null;
    missingInfo: boolean;
    source: string;
    score: number | null;
    approved: boolean;
    lsqLeadId: string | null;
  }> = [];

  const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];

  for (const r of rows) {
    const emailKey = r.email?.trim().toLowerCase();
    const nameAccountKey = `${r.name.trim()}|${r.account.trim()}`.toLowerCase();
    const existing = (emailKey ? existingByEmail.get(emailKey) : null) ?? existingByNameAccount.get(nameAccountKey);

    const normalizedPhone = normalizeE164(r.phone);
    const extrasJson = r.extras && Object.keys(r.extras).length > 0 ? JSON.stringify(r.extras) : null;

    if (existing) {
      // A refreshed title has to drag function/seniority with it. They're
      // derived from the title on create but were left untouched here, so
      // re-importing a cleaned CSV left "VP Marketing" sitting on the
      // Other/IC classification from the first import — and those two fields
      // are exactly what scoring and personalization read.
      const titleChanged = r.title !== '—' && r.title !== existing.title;
      toUpdate.push({
        id: existing.id,
        data: {
          name: r.name,
          account: r.account,
          vertical: r.vertical !== 'Unassigned' ? r.vertical : existing.vertical,
          title: r.title !== '—' ? r.title : existing.title,
          ...(titleChanged ? { function: functionFor(r.title), seniority: seniorityFor(r.title) } : {}),
          // A contact first imported by name+account may have had no email at
          // all; a later import that carries one should fill it in rather than
          // silently keep the blank.
          ...(!existing.email && r.email ? { email: r.email, emailSimulated: false, emailVerified: true } : {}),
          phone: normalizedPhone ?? existing.phone,
          ...(r.linkedinId ? { linkedinId: r.linkedinId } : {}),
          whatsappOptIn: r.whatsappOptIn ?? existing.whatsappOptIn,
          smsOptOut: r.smsOptOut ?? existing.smsOptOut,
          extraFieldsJson: extrasJson ?? existing.extraFieldsJson,
          lsqLeadId: r.lsqLeadId ?? existing.lsqLeadId,
        },
      });
    } else {
      toCreate.push({
        campaignId,
        name: r.name,
        email: r.email ? r.email.trim().toLowerCase() : null,
        account: r.account,
        vertical: r.vertical,
        title: r.title,
        function: r.function,
        seniority: r.seniority,
        linkedinId: r.linkedinId || null,
        phone: normalizedPhone,
        whatsappOptIn: r.whatsappOptIn ?? false,
        smsOptOut: r.smsOptOut ?? false,
        extraFieldsJson: extrasJson,
        missingInfo: r.missingInfo,
        source: r.source,
        score: null,
        approved: false,
        lsqLeadId: r.lsqLeadId ?? null,
      });
    }
  }

  // Execute updates in batches of 100
  for (let i = 0; i < toUpdate.length; i += 100) {
    const batch = toUpdate.slice(i, i + 100);
    await db.$transaction(
      batch.map((u) => db.contact.update({ where: { id: u.id }, data: u.data }))
    );
  }

  // Execute creates in batches of 100
  for (let i = 0; i < toCreate.length; i += 100) {
    const batch = toCreate.slice(i, i + 100);
    await db.contact.createMany({ data: batch });
  }
}


export interface ImportIssue {
  /** 1-based spreadsheet row number, counting the header as row 1. */
  row: number;
  kind: 'invalid_email' | 'missing_name' | 'missing_email';
  message: string;
}

export interface CsvImportResult {
  ok: boolean;
  error?: string;
  rowCount?: number;
  dupes?: number;
  withEmail?: number;
  /** Contacts actually stored: data rows minus blank rows and merged duplicates. */
  imported?: number;
  skippedBlank?: number;
  /** Rows an operator should look at (invalid email, no name). Capped at 50. */
  issues?: ImportIssue[];
  headers?: string[];
  columnMap?: { role: string; header: string }[];
  logLines?: string[];
}

export async function importCsvAction(campaignId: string, formData: FormData): Promise<CsvImportResult> {
  const lockedMessage = await setupLockError(campaignId);
  if (lockedMessage) return { ok: false, error: lockedMessage };
  const file = formData.get('file') as File | null;
  if (!file) return { ok: false, error: 'No file provided.' };

  const text = await file.text();
  const rows = parseCsvText(text);
  if (rows.length < 2) return { ok: false, error: 'That file has a header but no data rows.' };

  const headersRaw = rows[0].map((h) => String(h).trim());
  const headers = headersRaw.map((h) => h.toLowerCase());
  // First/last are resolved BEFORE the full-name column and then excluded from
  // it: otherwise `'name'` substring-matches "First Name" on the most common
  // export shape (First Name,Last Name,Email,Company) and every contact imports
  // as "Priya" rather than "Priya Nair" — which then propagates into merge
  // fields, the CRM sync and Apollo's match confidence.
  const firstCol = pickCol(headers, ['first name', 'firstname', 'first']);
  const lastCol = pickCol(headers, ['last name', 'lastname', 'surname', 'last']);
  const phoneCol = pickCol(headers, ['phone', 'mobile', 'contact number', 'whatsapp number', 'whatsapp']);
  const ci = {
    name: pickCol(headers, ['full name', 'fullname', 'contact name', 'name'], { exclude: [firstCol, lastCol] }),
    first: firstCol,
    last: lastCol,
    email: pickCol(headers, ['email', 'e-mail']),
    account: pickCol(headers, ['company', 'account', 'organisation', 'organization']),
    title: pickCol(headers, ['title', 'designation', 'role', 'position']),
    vertical: pickCol(headers, ['vertical', 'industry', 'sector']),
    linkedin: pickCol(headers, ['linkedin', 'li url', 'profile']),
    phone: phoneCol,
    smsOptOut: pickCol(headers, ['sms opt-out', 'sms optout', 'sms dnd', 'do not sms']),
    // Consent must come from the source data — the place the person actually
    // agreed — not from an operator toggling a switch later, and not inferred
    // from a differently-scoped consent column: a bare "Email Opt-In" used to
    // satisfy the `'opt-in'` key here and silently granted WhatsApp consent to
    // people who only ever agreed to email, which is exactly the kind of thing
    // that gets a business number banned under Meta's policy.
    waOptIn: pickCol(
      headers,
      ['whatsapp opt-in', 'whatsapp optin', 'whatsapp consent', 'wa opt-in', 'wa consent'],
      { exclude: [phoneCol], reject: /e-?mail|sms|call|phone|number/ }
    ),
  };

  // Any column not claimed by a first-class field above is retained rather than
  // dropped — an operator's CSV often carries region, owner, plan tier etc.
  const claimed = new Set(Object.values(ci).filter((i) => i >= 0));
  const extraCols = headersRaw.map((h, i) => ({ header: h, index: i })).filter((c) => !claimed.has(c.index) && c.header !== '');

  const seen = new Set<string>();
  let dupes = 0;
  let skippedBlank = 0;
  const issues: ImportIssue[] = [];
  const addIssue = (issue: ImportIssue) => {
    if (issues.length < 50) issues.push(issue);
  };
  const classified = [];
  for (const [idx, r] of rows.slice(1).entries()) {
    const rowNumber = idx + 2;
    if (r.every((cell) => String(cell ?? '').trim() === '')) {
      skippedBlank++;
      continue;
    }
    const get = (i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const extras: Record<string, string> = {};
    for (const c of extraCols) {
      const v = get(c.index);
      if (v) extras[c.header] = v;
    }
    const givenName = get(ci.name) || [get(ci.first), get(ci.last)].filter(Boolean).join(' ');
    const rawEmail = get(ci.email);
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
    // An unusable address is kept out of the email field (it would fail the CRM sync and
    // be counted as send-ready) but preserved as metadata so nothing the operator typed is lost.
    const email = emailOk ? rawEmail : '';
    if (rawEmail && !emailOk) {
      extras['Original email (invalid)'] = rawEmail;
      addIssue({ row: rowNumber, kind: 'invalid_email', message: `"${rawEmail}" is not a valid email address, so this contact was kept without an email and queued for enrichment.` });
    } else if (!rawEmail) {
      addIssue({ row: rowNumber, kind: 'missing_email', message: 'No email address, so this contact was queued for enrichment.' });
    }
    const name = givenName || (emailOk ? rawEmail.split('@')[0] : '') || 'Unnamed contact';
    if (!givenName) {
      addIssue({ row: rowNumber, kind: 'missing_name', message: `No name in this row, so it was imported as "${name}".` });
    }
    const account = get(ci.account) || '—';
    const key = (email || `${name}|${account}`).toLowerCase();
    if (seen.has(key)) {
      dupes++;
      continue;
    }
    seen.add(key);
    classified.push(
      classifyContact({
        name,
        email,
        account,
        title: get(ci.title) || '—',
        vertical: get(ci.vertical) || 'Unassigned',
        linkedinId: get(ci.linkedin),
        phone: get(ci.phone) || null,
        whatsappOptIn: ci.waOptIn >= 0 ? /^(y|yes|true|1|opted.?in|granted)$/i.test(get(ci.waOptIn)) : undefined,
        smsOptOut: ci.smsOptOut >= 0 ? /^(y|yes|true|1|dnd|stop|opted.?out)$/i.test(get(ci.smsOptOut)) : undefined,
        extras,
      })
    );
  }

  await upsertContacts(campaignId, classified);

  const withEmail = classified.filter((c) => !c.missingInfo).length;
  const columnMap = Object.entries(ci)
    .filter(([, i]) => i >= 0)
    .map(([role, i]) => ({ role, header: headersRaw[i] }));
  const mapped = columnMap.map(({ role, header }) => `${role} → ${header}`).join(', ');

  const logLines = [
    `Read ${file.name} — ${headersRaw.length} columns, ${rows.length - 1} data rows${skippedBlank ? ` (${skippedBlank} blank skipped)` : ''}`,
    `Mapped columns: ${mapped || 'none matched'}`,
    `${dupes} duplicate rows merged by email/company match`,
    `${classified.length - withEmail} contacts have no usable email — queued for Apollo enrichment`,
  ];

  const sync = await syncContactsToLeadSquared(campaignId, { createList: false });
  if (sync.error) {
    logLines.push(`LeadSquared sync failed: ${sync.error.slice(0, 200)}`);
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'LeadSquared lead sync failed',
      detail: sync.error.slice(0, 600),
      actionsCsv: 'retry',
    });
  } else {
    const listInfo = sync.listId ? `, added to list ${sync.listId}` : '';
    logLines.push(`Synced to LeadSquared: ${sync.leadsCreated} leads created, ${sync.leadsUpdated} updated${listInfo}`);
    await resolveAttentionItems(campaignId, ['LeadSquared lead sync failed']);
  }

  await db.activityLogEntry.createMany({
    data: logLines.map((text) => ({ campaignId, text, dot: sync.error ? 'var(--warning-700)' : 'var(--accent-500)' })),
  });

  revalidateCampaign(campaignId);
  return { ok: true, rowCount: rows.length - 1, imported: classified.length, skippedBlank, issues, dupes, withEmail, headers: headersRaw, columnMap, logLines };
}

export interface FetchLsqListsResponse {
  ok: boolean;
  lists: LsqList[];
  tenantHost: string;
  senderEmail: string;
  error?: string;
}

export async function fetchLsqListsAction(): Promise<FetchLsqListsResponse> {
  try {
    const host = (await resolveIntegrationField('lsq', 'host')) || '';
    const senderEmail = (await resolveIntegrationField('lsq', 'senderEmail')) || '';
    const cleanHost = host.replace(/https?:\/\//, '').replace(/\/.*$/, '');

    const rawLists = await getLists();

    // Intelligent list organization:
    // 1. Priority 1: Lists with active leads (MemberCount > 0), ordered by MemberCount descending.
    // 2. Priority 2: Custom user lists with MemberCount === 0 (newest first).
    // 3. Priority 3: System default 0-member lists (Starred Leads, All Contacts) placed at the bottom.
    const isSystemList = (name: string) => /^(starred leads|all contacts)$/i.test(name.trim());

    const withMembers = rawLists.filter((l) => (l.MemberCount ?? 0) > 0).sort((a, b) => (b.MemberCount ?? 0) - (a.MemberCount ?? 0));
    const customEmpty = rawLists.filter((l) => (l.MemberCount ?? 0) === 0 && !isSystemList(l.ListName)).reverse();
    const systemEmpty = rawLists.filter((l) => (l.MemberCount ?? 0) === 0 && isSystemList(l.ListName));

    const sortedLists = [...withMembers, ...customEmpty, ...systemEmpty];

    return {
      ok: true,
      lists: sortedLists,
      tenantHost: cleanHost,
      senderEmail,
    };
  } catch (err) {
    return {
      ok: false,
      lists: [],
      tenantHost: '',
      senderEmail: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function rawLeadToContact(row: RawLsqLead) {
  const name = [row.FirstName, row.LastName].filter(Boolean).join(' ').trim() || row.EmailAddress || 'Unnamed contact';
  const standardKeys = new Set(['FirstName', 'LastName', 'EmailAddress', 'Company', 'Designation', 'Phone', 'ProspectID']);
  const extras: Record<string, string> = {};
  for (const [key, value] of Object.entries(row)) {
    if (!standardKeys.has(key) && value !== null && value !== undefined) {
      extras[key] = String(value);
    }
  }

  const rawLinkedIn =
    row.mx_LinkedIn_Profile ||
    row.mx_Linkedin_Profile ||
    row.LinkedIn ||
    row.LinkedInUrl ||
    row.mx_LinkedIn_Url ||
    row.mx_Linkedin_Url ||
    row.mx_LinkedIn ||
    row.mx_Linkedin ||
    '';

  return {
    ...classifyContact({
      name,
      email: row.EmailAddress || '',
      account: row.Company || '—',
      title: row.Designation || '—',
      vertical: 'Unassigned',
      linkedinId: rawLinkedIn.trim(),
      phone: row.Phone || null,
      extras: Object.keys(extras).length > 0 ? extras : undefined,
    }),
    // Already a real lead — reuse its id instead of creating a duplicate.
    lsqLeadId: row.ProspectID || undefined,
  };
}

export async function importFromLsqListAction(campaignId: string, listId: string, listName: string): Promise<CsvImportResult> {
  const lockedMessage = await setupLockError(campaignId);
  if (lockedMessage) return { ok: false, error: lockedMessage };
  try {
    // Explicitly bind campaign to the selected LeadSquared list so no new duplicate list is created.
    await db.campaign.update({
      where: { id: campaignId },
      data: { lsqListId: listId },
    });

    const rawLeads = await getLeadsInList(listId);
    const classified = rawLeads.map(rawLeadToContact);
    await upsertContacts(campaignId, classified);

    const withEmail = classified.filter((c) => !c.missingInfo).length;
    const logLines = [
      `Bound campaign to LeadSquared list "${listName}" (${listId})`,
      `Fetched ${classified.length} contacts from LeadSquared list "${listName}"`,
      `${classified.length - withEmail} contacts have no usable email on file`,
    ];

    const sync = await syncContactsToLeadSquared(campaignId, { createList: false });
    if (sync.error) {
      logLines.push(`LeadSquared list sync failed: ${sync.error.slice(0, 200)}`);
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LeadSquared lead sync failed',
        detail: sync.error.slice(0, 600),
        actionsCsv: 'retry',
      });
    } else {
      logLines.push(`Synced contacts to LeadSquared list "${listName}" (${listId})`);
      await resolveAttentionItems(campaignId, ['LeadSquared lead sync failed']);
    }

    await db.activityLogEntry.createMany({ data: logLines.map((text) => ({ campaignId, text, dot: sync.error ? 'var(--warning-700)' : 'var(--accent-500)' })) });

    revalidateCampaign(campaignId);
    return { ok: true, rowCount: classified.length, withEmail, logLines };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}




/**
 * Pre-import safety net: pairs the CSV's headers with real LeadSquared fields
 * and type-checks every value BEFORE anything is written.
 *
 * Split by design — Claude proposes the header→field pairing (a fuzzy naming
 * problem across 250+ terse schema names), while `preflightCsvRows` decides
 * whether values are actually writable. Type checking stays deterministic so a
 * confident-sounding model can never wave bad data into the CRM.
 */
export async function analyzeCsvMappingAction(headers: string[], sampleRows: Array<Record<string, string>>) {
  try {
    const { getLeadsMetadata } = await import('@/lib/leadsquared');
    const { mapCsvColumnsToLsqFields } = await import('@/lib/claude');
    const { preflightCsvRows } = await import('@/lib/csvPreflight');

    const fields = await getLeadsMetadata();
    const { mappings, unmapped } = await mapCsvColumnsToLsqFields({ headers, fields });

    const fieldTypes: Record<string, string> = {};
    for (const f of fields) fieldTypes[f.SchemaName] = f.DataType;

    const report = preflightCsvRows({ rows: sampleRows, mappings, fieldTypes });
    return { ok: true as const, mappings, unmapped, report, lsqFieldCount: fields.length };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 300) };
  }
}

/**
 * Chooses which existing LeadSquared list imported leads land in. Only static
 * lists accept additions — dynamic lists are query-driven and reject writes.
 * Passing null restores the default of auto-creating a per-campaign list.
 */
export async function setCampaignListAction(campaignId: string, listId: string | null) {
  await assertSetupEditable(campaignId);
  await db.campaign.update({ where: { id: campaignId }, data: { lsqListId: listId } });
  revalidateCampaign(campaignId);
  return { ok: true as const };
}

/** Static lists only — the ones that can actually receive leads. */
export async function getStaticListsAction() {
  try {
    const lists = await getLists();
    return {
      ok: true as const,
      lists: lists
        .filter((l) => /static/i.test(String(l.ListType)))
        .sort((a, b) => (b.MemberCount ?? 0) - (a.MemberCount ?? 0))
        .map((l) => ({ id: l.ListId, name: l.ListName, members: l.MemberCount })),
    };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}
