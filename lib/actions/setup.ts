'use server';

import { db } from '@/lib/db';
import { getLists, getLeadsInList, getLeadByEmailAddress, type RawLsqLead } from '@/lib/leadsquared';
import { classifyContact, pickCol } from '@/lib/importHeuristics';
import { syncContactsToLeadSquared } from '@/lib/leadSync';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';
import { parseCsvText } from '@/lib/csv';

export async function updateCampaignName(campaignId: string, name: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { name } });
  revalidateCampaign(campaignId);
}

export async function updateCampaignDescription(campaignId: string, description: string) {
  await db.campaign.update({ where: { id: campaignId }, data: { description } });
  revalidateCampaign(campaignId);
}

const ZOOM_HOSTS = /(^|\.)(zoom\.us|zoomgov\.com)$/i;

/**
 * Stores the event link. Zoom URLs are the expected case but any https link is
 * accepted — plenty of teams run these on Teams, Meet, or their own page — so the
 * check reports what it recognised instead of blocking.
 */
export async function updateCampaignZoomLink(campaignId: string, zoomLink: string) {
  const trimmed = zoomLink.trim();
  if (!trimmed) {
    await db.campaign.update({ where: { id: campaignId }, data: { zoomLink: null } });
    revalidateCampaign(campaignId);
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

  await db.campaign.update({ where: { id: campaignId }, data: { zoomLink: trimmed } });
  revalidateCampaign(campaignId);
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
  const trimmed = link.trim();
  if (!trimmed) return { ok: false as const, error: 'The registration link cannot be empty — contacts need somewhere to sign up.' };

  await db.campaign.update({ where: { id: campaignId }, data: { registrationLink: trimmed } });
  await db.activityLogEntry.create({
    data: { campaignId, text: `Registration link updated to ${trimmed}`, dot: 'var(--accent-500)' },
  });
  revalidateCampaign(campaignId);
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
  if (!dateTimeLocal) {
    await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: null, date: 'Not scheduled yet' } });
    revalidateCampaign(campaignId);
    return { ok: true as const, display: 'Not scheduled yet' };
  }

  const parsed = new Date(dateTimeLocal);
  if (Number.isNaN(parsed.getTime())) return { ok: false as const, error: 'That date could not be read.' };

  const display = formatWebinarDate(parsed);
  await db.campaign.update({ where: { id: campaignId }, data: { scheduledAt: parsed, date: display } });
  revalidateCampaign(campaignId);
  return { ok: true as const, display };
}

async function replaceContacts(campaignId: string, rows: (ReturnType<typeof classifyContact> & { lsqLeadId?: string })[]) {
  await db.contact.deleteMany({ where: { campaignId } });
  if (rows.length === 0) return;
  await db.contact.createMany({
    data: rows.map((r) => ({
      campaignId,
      name: r.name,
      email: r.email || null,
      account: r.account,
      vertical: r.vertical,
      title: r.title,
      function: r.function,
      seniority: r.seniority,
      linkedinId: r.linkedinId || null,
      phone: r.phone || null,
      extraFieldsJson: r.extras && Object.keys(r.extras).length > 0 ? JSON.stringify(r.extras) : null,
      missingInfo: r.missingInfo,
      source: r.source,
      score: null,
      approved: false,
      lsqLeadId: r.lsqLeadId ?? null,
    })),
  });
}


export interface CsvImportResult {
  ok: boolean;
  error?: string;
  rowCount?: number;
  dupes?: number;
  withEmail?: number;
  headers?: string[];
  columnMap?: { role: string; header: string }[];
  logLines?: string[];
}

export async function importCsvAction(campaignId: string, formData: FormData): Promise<CsvImportResult> {
  const file = formData.get('file') as File | null;
  if (!file) return { ok: false, error: 'No file provided.' };

  const text = await file.text();
  const rows = parseCsvText(text);
  if (rows.length < 2) return { ok: false, error: 'That file has a header but no data rows.' };

  const headersRaw = rows[0].map((h) => String(h).trim());
  const headers = headersRaw.map((h) => h.toLowerCase());
  const ci = {
    name: pickCol(headers, ['full name', 'name', 'contact']),
    first: pickCol(headers, ['first']),
    last: pickCol(headers, ['last']),
    email: pickCol(headers, ['email', 'e-mail']),
    account: pickCol(headers, ['company', 'account', 'organisation', 'organization']),
    title: pickCol(headers, ['title', 'designation', 'role', 'position']),
    vertical: pickCol(headers, ['vertical', 'industry', 'sector']),
    linkedin: pickCol(headers, ['linkedin', 'li url', 'profile']),
    phone: pickCol(headers, ['phone', 'mobile', 'contact number', 'whatsapp']),
  };

  // Any column not claimed by a first-class field above is retained rather than
  // dropped — an operator's CSV often carries region, owner, plan tier etc.
  const claimed = new Set(Object.values(ci).filter((i) => i >= 0));
  const extraCols = headersRaw.map((h, i) => ({ header: h, index: i })).filter((c) => !claimed.has(c.index) && c.header !== '');

  const seen = new Set<string>();
  let dupes = 0;
  const classified = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    const extras: Record<string, string> = {};
    for (const c of extraCols) {
      const v = get(c.index);
      if (v) extras[c.header] = v;
    }
    const name = get(ci.name) || [get(ci.first), get(ci.last)].filter(Boolean).join(' ') || 'Unnamed contact';
    const email = get(ci.email);
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
        extras,
      })
    );
  }

  await replaceContacts(campaignId, classified);

  const withEmail = classified.filter((c) => !c.missingInfo).length;
  const columnMap = Object.entries(ci)
    .filter(([, i]) => i >= 0)
    .map(([role, i]) => ({ role, header: headersRaw[i] }));
  const mapped = columnMap.map(({ role, header }) => `${role} → ${header}`).join(', ');

  const logLines = [
    `Read ${file.name} — ${headersRaw.length} columns, ${rows.length - 1} data rows`,
    `Mapped columns: ${mapped || 'none matched'}`,
    `${dupes} duplicate rows merged by email/company match`,
    `${classified.length - withEmail} contacts have no usable email — queued for Apollo/Apify enrichment`,
  ];

  const sync = await syncContactsToLeadSquared(campaignId);
  if (sync.error) {
    logLines.push(`LeadSquared sync failed: ${sync.error.slice(0, 200)}`);
    await upsertAttentionItem(campaignId, {
      icon: 'ErrorProperty1Outline',
      color: 'error',
      title: 'LeadSquared lead sync failed',
      detail: sync.error.slice(0, 300),
      actionsCsv: 'retry',
    });
  } else {
    logLines.push(`Synced to LeadSquared: ${sync.leadsCreated} leads created, ${sync.leadsUpdated} updated, added to list ${sync.listId}`);
  }

  await db.activityLogEntry.createMany({
    data: logLines.map((text) => ({ campaignId, text, dot: sync.error ? 'var(--warning-700)' : 'var(--accent-500)' })),
  });

  revalidateCampaign(campaignId);
  return { ok: true, rowCount: rows.length - 1, dupes, withEmail, headers: headersRaw, columnMap, logLines };
}

export async function fetchLsqListsAction() {
  return getLists();
}

function rawLeadToContact(row: RawLsqLead) {
  const name = [row.FirstName, row.LastName].filter(Boolean).join(' ').trim() || row.EmailAddress || 'Unnamed contact';
  return {
    ...classifyContact({
      name,
      email: row.EmailAddress || '',
      account: row.Company || '—',
      title: row.Designation || '—',
      vertical: 'Unassigned',
      linkedinId: '',
      phone: row.Phone || null,
    }),
    // Already a real lead — reuse its id instead of creating a duplicate.
    lsqLeadId: row.ProspectID || undefined,
  };
}

export async function importFromLsqListAction(campaignId: string, listId: string, listName: string): Promise<CsvImportResult> {
  try {
    const rawLeads = await getLeadsInList(listId);
    const classified = rawLeads.map(rawLeadToContact);
    await replaceContacts(campaignId, classified);

    const withEmail = classified.filter((c) => !c.missingInfo).length;
    const logLines = [`Fetched ${classified.length} contacts from LeadSquared list "${listName}"`, `${classified.length - withEmail} contacts have no usable email on file`];

    const sync = await syncContactsToLeadSquared(campaignId);
    if (sync.error) {
      logLines.push(`LeadSquared list sync failed: ${sync.error.slice(0, 200)}`);
      await upsertAttentionItem(campaignId, {
        icon: 'ErrorProperty1Outline',
        color: 'error',
        title: 'LeadSquared lead sync failed',
        detail: sync.error.slice(0, 300),
        actionsCsv: 'retry',
      });
    } else {
      logLines.push(`Added ${withEmail} contacts to LeadSquared campaign list ${sync.listId}`);
    }

    await db.activityLogEntry.createMany({ data: logLines.map((text) => ({ campaignId, text, dot: sync.error ? 'var(--warning-700)' : 'var(--accent-500)' })) });

    revalidateCampaign(campaignId);
    return { ok: true, rowCount: classified.length, withEmail, logLines };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// --- single-lead lookup straight from the LeadSquared platform -----------------

export interface LsqLeadLookup {
  name: string;
  email: string;
  phone: string;
  account: string;
  title: string;
  lsqLeadId: string;
  /** Any other populated attributes LSQ returned, for transparency. */
  extra: Array<[string, string]>;
}

const KNOWN_ATTRS = new Set(['FirstName', 'LastName', 'EmailAddress', 'Phone', 'Company', 'Designation', 'ProspectID', 'SearchBy']);

function mapRawLead(row: RawLsqLead): LsqLeadLookup {
  const name = [row.FirstName, row.LastName].filter(Boolean).join(' ').trim() || row.EmailAddress || 'Unnamed lead';
  const extra: Array<[string, string]> = [];
  for (const [attr, value] of Object.entries(row)) {
    if (!KNOWN_ATTRS.has(attr) && typeof value === 'string' && value.trim() && value !== '[]') {
      extra.push([attr, value.trim()]);
    }
  }
  return {
    name,
    email: row.EmailAddress ?? '',
    phone: row.Phone ?? '',
    account: row.Company ?? '',
    title: row.Designation ?? '',
    lsqLeadId: row.ProspectID ?? '',
    extra,
  };
}

/** Looks up ONE lead on the LeadSquared platform by exact email address. */
export async function fetchLsqLeadByEmailAction(
  email: string
): Promise<{ ok: true; lead: LsqLeadLookup } | { ok: false; notFound?: boolean; error: string }> {
  const clean = email.trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return { ok: false, error: 'Enter a valid email address.' };
  try {
    const row = await getLeadByEmailAddress(clean);
    if (!row) return { ok: false, notFound: true, error: `No LeadSquared lead found with email ${clean}.` };
    return { ok: true, lead: mapRawLead(row) };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 250) };
  }
}

/**
 * Fetches the lead by email AND imports it into this campaign as a fully-
 * detailed Contact (reusing its existing LeadSquared lead id so future syncs
 * update rather than duplicate).
 */
export async function importLsqLeadByEmailAction(
  campaignId: string,
  email: string
): Promise<{ ok: boolean; contactId?: string; mode?: 'created' | 'updated'; error?: string }> {
  const clean = email.trim();
  try {
    const row = await getLeadByEmailAddress(clean);
    if (!row || !row.EmailAddress) return { ok: false, error: `No LeadSquared lead found with email ${clean}.` };

    const classified = classifyContact({
      name: [row.FirstName, row.LastName].filter(Boolean).join(' ').trim() || row.EmailAddress,
      email: row.EmailAddress,
      account: row.Company || '—',
      title: row.Designation || '—',
      vertical: 'Unassigned',
      linkedinId: '',
      phone: row.Phone || null,
    });

    const existingByLsqId = row.ProspectID
      ? await db.contact.findFirst({ where: { lsqLeadId: row.ProspectID }, select: { id: true } })
      : null;
    const existing =
      existingByLsqId ??
      (await db.contact.findFirst({ where: { campaignId, email: clean.toLowerCase() }, select: { id: true } }));

    const dataFields = {
      name: classified.name,
      email: classified.email,
      phone: classified.phone || null,
      account: classified.account,
      title: classified.title,
      vertical: classified.vertical,
      function: classified.function,
      seniority: classified.seniority,
      missingInfo: classified.missingInfo,
    };

    let contactId: string;
    let mode: 'created' | 'updated';
    if (existing) {
      await db.contact.update({
        where: { id: existing.id },
        data: { ...dataFields, lsqLeadId: row.ProspectID || undefined },
      });
      contactId = existing.id;
      mode = 'updated';
    } else {
      const created = await db.contact.create({
        data: { campaignId, ...dataFields, lsqLeadId: row.ProspectID || undefined },
      });
      contactId = created.id;
      mode = 'created';
    }

    await db.activityLogEntry.create({
      data: {
        campaignId,
        text: `Fetched ${classified.name} from LeadSquared by email (${mode}) — imported with platform details and linked to their LSQ lead`,
        dot: 'var(--accent-500)',
      },
    });
    revalidateCampaign(campaignId);
    return { ok: true, contactId, mode };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err).slice(0, 250) };
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
        .map((l) => ({ id: l.ListId, name: l.ListName, members: l.MemberCount })),
    };
  } catch (err) {
    return { ok: false as const, error: String(err instanceof Error ? err.message : err).slice(0, 200) };
  }
}
