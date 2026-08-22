'use server';

import { db } from '@/lib/db';
import { getLists, getLeadsInList, type RawLsqLead } from '@/lib/leadsquared';
import { classifyContact, pickCol } from '@/lib/importHeuristics';
import { syncContactsToLeadSquared } from '@/lib/leadSync';
import { upsertAttentionItem } from '@/lib/attentionItems';
import { formatWebinarDate } from '@/lib/campaignDate';
import { revalidateCampaign } from '@/lib/revalidate';

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

/** Takes a datetime-local value ("2026-08-28T15:00") and stores both forms. */
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
      missingInfo: r.missingInfo,
      source: r.source,
      score: null,
      approved: false,
      lsqLeadId: r.lsqLeadId ?? null,
    })),
  });
}

function parseCsvText(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let val = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          val += '"';
          i++;
        } else q = false;
      } else val += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === '\t') {
      cur.push(val);
      val = '';
    } else if (ch === '\n') {
      cur.push(val);
      rows.push(cur);
      cur = [];
      val = '';
    } else if (ch !== '\r') val += ch;
  }
  if (val.length || cur.length) {
    cur.push(val);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
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
  };

  const seen = new Set<string>();
  let dupes = 0;
  const classified = [];
  for (const r of rows.slice(1)) {
    const get = (i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
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
