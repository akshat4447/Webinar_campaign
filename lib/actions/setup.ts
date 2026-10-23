'use server';

import { requireOperatorSession } from '@/lib/operatorSession';

import { db } from '@/lib/db';
import { getLists, readLeadsInList, LeadSquaredError, type ListReadCursor, type RawLsqLead } from '@/lib/leadsquared';
import { classifyContact, pickCol, functionFor, seniorityFor } from '@/lib/importHeuristics';
import { syncContactsToLeadSquared } from '@/lib/leadSync';
import { upsertAttentionItem, resolveAttentionItems } from '@/lib/attentionItems';
import { revalidateCampaign } from '@/lib/revalidate';
import { parseCsvText } from '@/lib/csv';
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
import { z } from 'zod';
import { writeWebinarSchedule } from '@/lib/webinarSchedule';
import { plainError } from '@/lib/plainError';


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
  await requireOperatorSession();
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
  await requireOperatorSession();
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  await db.campaign.update({ where: { id: validCampaignId }, data: { name } });
  revalidateCampaign(validCampaignId);
}

export async function updateCampaignDescription(campaignId: string, description: string) {
  await requireOperatorSession();
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
  await requireOperatorSession();
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
  await requireOperatorSession();
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
  await requireOperatorSession();
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

export async function updateCampaignCapacityAction(campaignId: string, capacity: number | null) {
  await requireOperatorSession();
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
  await requireOperatorSession();
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

/** The wizard's date picker: a draft's date, written together with its display form (see lib/webinarSchedule.ts). */
export async function updateCampaignSchedule(campaignId: string, dateTimeLocal: string) {
  await requireOperatorSession();
  await assertSetupEditable(campaignId);
  const validCampaignId = campaignIdSchema.parse(campaignId);
  return writeWebinarSchedule(validCampaignId, dateTimeLocal);
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

/** Where a long LeadSquared list import carries on from; the browser hands it back unchanged. */
export interface LsqImportCursor {
  list: ListReadCursor;
  phase: 'forward' | 'reverse';
  /** Leads read so far in the pass that ran from newest to oldest, and in the one that ran back from the other end. */
  forwardCount: number;
  reverseCount: number;
  /** The list's size according to LeadSquared (the list's own count, or a clearly-total RecordCount). */
  expectedTotal: number | null;
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
  /** LeadSquared list imports run in slices: false means call again with `cursor`. */
  done?: boolean;
  cursor?: LsqImportCursor;
  /** Set when LeadSquared handed back fewer leads than the list holds. */
  warning?: string;
}

export async function importCsvAction(campaignId: string, formData: FormData): Promise<CsvImportResult> {
  await requireOperatorSession();
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
    `${dupes} duplicate ${dupes === 1 ? 'row' : 'rows'} merged by email/company match`,
    `${classified.length - withEmail} ${classified.length - withEmail === 1 ? 'contact has' : 'contacts have'} no usable email — queued for Apollo enrichment`,
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
  await requireOperatorSession();
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

/** How long one slice of a list import may keep fetching before it saves what it has and asks to be called again. */
const LSQ_IMPORT_SLICE_MS = 40_000;
const importSliceMs = () => (Number(process.env.LSQ_IMPORT_SLICE_MS) > 0 ? Number(process.env.LSQ_IMPORT_SLICE_MS) : LSQ_IMPORT_SLICE_MS);

/**
 * Imports a LeadSquared list, in slices. A big list cannot be read inside one request (LeadSquared allows 25
 * calls per 5 seconds, so 20,000 leads at 500 per page is a minute or more), so each call reads for about
 * {@link LSQ_IMPORT_SLICE_MS}, stores what it read, and returns a cursor. The caller keeps calling with that
 * cursor until `done`; stopping part-way leaves a valid partial import that can be resumed by importing again.
 */
export async function importFromLsqListAction(campaignId: string, listId: string, listName: string, cursor?: LsqImportCursor): Promise<CsvImportResult> {
  await requireOperatorSession();
  const lockedMessage = await setupLockError(campaignId);
  if (lockedMessage) return { ok: false, error: lockedMessage };
  try {
    let state: LsqImportCursor;
    if (cursor) {
      state = cursor;
    } else {
      // Explicitly bind campaign to the selected LeadSquared list so no new duplicate list is created.
      await db.campaign.update({ where: { id: campaignId }, data: { lsqListId: listId } });
      let expectedTotal: number | null = null;
      try {
        const listed = (await getLists()).find((l) => l.ListId === listId);
        if (listed && Number.isFinite(listed.MemberCount) && listed.MemberCount > 0) expectedTotal = listed.MemberCount;
      } catch {
        // The count only decides whether to warn; the import itself does not depend on it.
      }
      state = { list: { nextPage: 1, pageSize: 500, direction: 'newest' }, phase: 'forward', forwardCount: 0, reverseCount: 0, expectedTotal };
    }

    // On the second pass only as much as is still missing is worth reading.
    const stillMissing = state.expectedTotal !== null ? Math.max(0, state.expectedTotal - state.forwardCount - state.reverseCount) : undefined;
    let read: Awaited<ReturnType<typeof readLeadsInList>>;
    try {
      read = await readLeadsInList(listId, {
        pageSize: state.list.pageSize,
        startPage: state.list.nextPage,
        direction: state.list.direction,
        budgetMs: importSliceMs(),
        ...(state.phase === 'reverse' && stillMissing !== undefined ? { maxLeads: stillMissing } : {}),
      });
    } catch (err) {
      // A page deeper than LeadSquared will serve (it answers an error rather than an empty page) is the end of
      // what this pass can reach. Rate limiting and authentication problems are not: those are reported.
      const refused = err instanceof LeadSquaredError && ![401, 403, 429].includes(err.status);
      if (!(state.phase === 'forward' && state.forwardCount > 0 && refused)) throw err;
      read = { leads: [], cursor: null, reportedTotal: null, pages: 0 };
    }
    const classified = read.leads.map(rawLeadToContact);
    await upsertContacts(campaignId, classified);

    const expectedTotal = read.reportedTotal !== null ? Math.max(state.expectedTotal ?? 0, read.reportedTotal) : state.expectedTotal;
    const next: LsqImportCursor = {
      ...state,
      expectedTotal,
      forwardCount: state.forwardCount + (state.phase === 'forward' ? read.leads.length : 0),
      reverseCount: state.reverseCount + (state.phase === 'reverse' ? read.leads.length : 0),
    };
    const seen = next.forwardCount + next.reverseCount;

    // The second pass only reads what is still missing; once that is reached it is finished even though the
    // list itself has more pages.
    const secondPassDone = next.phase === 'reverse' && expectedTotal !== null && seen >= expectedTotal;
    if (read.cursor && !secondPassDone) {
      return { ok: true, done: false, cursor: { ...next, list: read.cursor }, rowCount: seen };
    }

    // End of the pass. If LeadSquared stopped returning pages before the list's own count was reached (a cap on
    // how deep it pages), read the list again from the other end: together the two passes cover up to twice what
    // one pass can reach, and the overlap is harmless because contacts are merged by email.
    const missing = expectedTotal !== null ? expectedTotal - seen : 0;
    if (next.phase === 'forward' && expectedTotal !== null && missing > Math.max(50, Math.round(expectedTotal * 0.02))) {
      return {
        ok: true,
        done: false,
        cursor: { ...next, phase: 'reverse', list: { nextPage: 1, pageSize: 500, direction: 'oldest' } },
        rowCount: seen,
      };
    }

    const distinct = expectedTotal !== null ? Math.min(seen, expectedTotal) : seen;
    const stillShort = expectedTotal !== null ? Math.max(0, expectedTotal - seen) : 0;
    const warning =
      stillShort > Math.max(50, Math.round((expectedTotal ?? 0) * 0.02))
        ? `LeadSquared returned ${distinct.toLocaleString()} of the ${expectedTotal!.toLocaleString()} leads LeadSquared reports for "${listName}". Its API stopped returning pages after that, or the count it shows is out of date. If leads are missing, split the list in LeadSquared into smaller lists and import them one at a time.`
        : undefined;

    const withEmail = await db.contact.count({ where: { campaignId, email: { not: null } } });
    const logLines = [
      `Bound campaign to LeadSquared list "${listName}" (${listId})`,
      `Fetched ${distinct.toLocaleString()} contacts from LeadSquared list "${listName}"${next.phase === 'reverse' ? ' (read from both ends of the list)' : ''}`,
      ...(warning ? [warning] : []),
    ];

    // The leads came from this list, so they are already in it: only contacts that were not LeadSquared leads
    // yet (CSV rows imported earlier) need creating, and only those are added to the list.
    const unsynced = await db.contact.count({ where: { campaignId, email: { not: null }, lsqLeadId: null } });
    let syncError: string | undefined;
    if (unsynced > 0) {
      const sync = await syncContactsToLeadSquared(campaignId, { createList: false, addToList: 'created' });
      syncError = sync.error;
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
        logLines.push(`Synced ${unsynced.toLocaleString()} new contacts to LeadSquared list "${listName}" (${listId})`);
        await resolveAttentionItems(campaignId, ['LeadSquared lead sync failed']);
      }
    } else {
      await resolveAttentionItems(campaignId, ['LeadSquared lead sync failed']);
    }

    await db.activityLogEntry.createMany({ data: logLines.map((text) => ({ campaignId, text, dot: syncError || warning ? 'var(--warning-700)' : 'var(--accent-500)' })) });

    revalidateCampaign(campaignId);
    return { ok: true, done: true, rowCount: distinct, withEmail, logLines, warning };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
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
  await requireOperatorSession();
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
  await requireOperatorSession();
  await assertSetupEditable(campaignId);
  await db.campaign.update({ where: { id: campaignId }, data: { lsqListId: listId } });
  revalidateCampaign(campaignId);
  return { ok: true as const };
}

/** Static lists only — the ones that can actually receive leads. */
export async function getStaticListsAction() {
  await requireOperatorSession();
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

/**
 * Runs the LeadSquared lead sync again for a webinar whose last sync failed. It does what "Retry" says: the failed item
 * is cleared only when this sync succeeds, and a failure replaces the item's detail with the new reason. The reason
 * is returned as a sentence rather than thrown, because production hides the message of a thrown server error.
 */
export async function retryLeadSquaredSyncAction(campaignId: string): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  await requireOperatorSession();
  const id = campaignIdSchema.parse(campaignId);
  const sync = await syncContactsToLeadSquared(id, { createList: false });
  if (sync.error) {
    const error = plainError(sync.error).slice(0, 600);
    await upsertAttentionItem(id, { icon: 'ErrorProperty1Outline', color: 'error', title: 'LeadSquared lead sync failed', detail: error, actionsCsv: 'retry' });
    return { ok: false, error };
  }
  await resolveAttentionItems(id, ['LeadSquared lead sync failed']);
  await db.activityLogEntry.create({ data: { campaignId: id, text: `Synced to LeadSquared: ${sync.leadsCreated} leads created, ${sync.leadsUpdated} updated`, dot: 'var(--success-500)' } });
  revalidateCampaign(id);
  return { ok: true, message: `Synced to LeadSquared: ${sync.leadsCreated} created, ${sync.leadsUpdated} updated.` };
}
