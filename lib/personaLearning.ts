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
 * analysis already trusts. It's not fed back into the scoring prompt (that
 * would be a real ML feedback loop, out of scope here) — the copy below is
 * adjusted to describe what this actually is: a track record, not a live loop.
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
