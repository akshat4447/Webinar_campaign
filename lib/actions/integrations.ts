'use server';

import { getLeadsMetadata } from '@/lib/leadsquared';
import { db } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

const LOG_KEYWORDS: Record<string, string[]> = {
  lsq: ['LeadSquared'],
  zoom: ['Zoom', 'attendance', 'attended', 'no-show'],
  claude: ['Claude', 'scored', 'rewrit'],
  apollo: ['Apollo'],
  apify: ['Apify'],
  linkedin: ['LinkedIn'],
};

export async function getIntegrationLogAction(integrationId: string) {
  const keywords = LOG_KEYWORDS[integrationId] ?? [integrationId];
  const entries = await db.activityLogEntry.findMany({
    where: { OR: keywords.map((k) => ({ text: { contains: k } })) },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { campaign: { select: { name: true } } },
  });
  return entries.map((e) => ({ campaign: e.campaign.name, text: e.text, time: e.createdAt.toISOString() }));
}

export async function testIntegrationAction(id: string): Promise<{ ok: boolean; detail: string }> {
  const started = Date.now();
  try {
    if (id === 'lsq') {
      const fields = await getLeadsMetadata();
      return { ok: true, detail: `200 · ${fields.length} lead fields · ${Date.now() - started}ms` };
    }
    if (id === 'claude') {
      const client = new Anthropic();
      const res = await client.messages.create({ model: 'claude-opus-5', max_tokens: 16, messages: [{ role: 'user', content: 'Reply with just: ok' }] });
      const text = res.content.find((b) => b.type === 'text');
      return { ok: true, detail: `200 · model responded "${text && 'text' in text ? text.text.trim() : ''}" · ${Date.now() - started}ms` };
    }
    if (id === 'apollo') {
      // Simulated handshake — no Apollo key in this build. The enrichment it
      // feeds is real Claude inference; the contact-detail lookup is stubbed.
      return { ok: true, detail: `200 · /v1/people/match · ${180 + (Date.now() % 90)}ms (simulated)` };
    }
    return { ok: false, detail: 'This integration stays in demo mode for this build.' };
  } catch (err) {
    return { ok: false, detail: String(err).slice(0, 200) };
  }
}
