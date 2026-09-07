import { db } from '@/lib/db';

export interface PersonaLearningRow {
  label: string;
  pct: number;
  sampleSize: number;
}

const MIN_SAMPLE = 3; // below this a rate is noise, not a signal worth acting on
const MAX_ROWS = 6;

/**
 * "Campaign-over-campaign learning" on the landing page used to render four
 * hardcoded percentages from lib/demo-data.ts under copy claiming they "feed
 * forward into the next scoring run" — nothing computed them and nothing read
 * them back into scoring. This computes a real signal instead: approval rate
 * by persona (seniority + function), across every scored contact in every
 * campaign, using the same score/approved fields the Dashboard's scoreBands
 * analysis already trusts. It IS fed back into scoring now — see
 * getPersonaLearningInsights() below, consumed by scoreContacts().
 */
export async function getPersonaLearning(): Promise<PersonaLearningRow[]> {
  const contacts = await db.contact.findMany({
    where: { score: { not: null } },
    select: { seniority: true, function: true, approved: true },
  });

  const byPersona = new Map<string, { approved: number; total: number }>();
  for (const c of contacts) {
    const label = `${c.seniority}-level, ${c.function}`;
    const bucket = byPersona.get(label) ?? { approved: 0, total: 0 };
    bucket.total++;
    if (c.approved) bucket.approved++;
    byPersona.set(label, bucket);
  }

  return [...byPersona.entries()]
    .filter(([, v]) => v.total >= MIN_SAMPLE)
    .map(([label, v]) => ({ label, pct: Math.round((v.approved / v.total) * 100), sampleSize: v.total }))
    .sort((a, b) => b.pct - a.pct || b.sampleSize - a.sampleSize)
    .slice(0, MAX_ROWS);
}

/**
 * Compiles historical campaign learning insights to ground Claude's scoring
 * prompt in real track-record performance data. Only scoreContacts() calls
 * this today — personalizeMessages() does not.
 */
export async function getPersonaLearningInsights(): Promise<string | null> {
  try {
    const rows = await getPersonaLearning();
    if (rows.length === 0) return null;

    const lines = rows.map((r) => `• ${r.label}: ${r.pct}% approval rate (sample: ${r.sampleSize} scored)`);
    return `HISTORICAL WEBINAR CAMPAIGN TRACK RECORD (PRIOR LEARNING):\n${lines.join('\n')}\nCalibrate your scores based on which personas have historically converted in past webinars.`;
  } catch {
    return null;
  }
}

