// The shared template library fills itself in on a database that never ran the demo seed, so a step the operator
// adds gets a starting message and does not block launch with "No valid template assigned". Real database.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let ensureTemplateLibrary: typeof import('@/lib/templateLibrary')['ensureTemplateLibrary'];
let templatesData: typeof import('@/lib/demo-data')['templatesData'];
let computeTemplatesReadiness: typeof import('@/lib/cadenceReadiness')['computeTemplatesReadiness'];
const made: string[] = [];

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  ({ ensureTemplateLibrary } = await import('@/lib/templateLibrary'));
  ({ templatesData } = await import('@/lib/demo-data'));
  ({ computeTemplatesReadiness } = await import('@/lib/cadenceReadiness'));
});
afterAll(async () => {
  await db.campaign.deleteMany({ where: { id: { in: made } } });
  await db.$disconnect();
});

describe('template library', () => {
  it('creates every missing library template and leaves an edited one alone', async () => {
    await ensureTemplateLibrary();
    const first = templatesData[0].id;
    const original = await db.messageTemplate.findFirstOrThrow({ where: { campaignId: null, key: first } });
    const missingKey = templatesData[templatesData.length - 1].id;
    await db.messageTemplate.deleteMany({ where: { campaignId: null, key: missingKey } });
    await db.messageTemplate.update({ where: { id: original.id }, data: { body: 'Edited by the operator {{link}}' } });
    try {
      expect(await ensureTemplateLibrary()).toBe(1);
      const keys = new Set((await db.messageTemplate.findMany({ where: { campaignId: null }, select: { key: true } })).map((t) => t.key));
      for (const t of templatesData) expect(keys.has(t.id)).toBe(true);
      expect((await db.messageTemplate.findUniqueOrThrow({ where: { id: original.id } })).body).toBe('Edited by the operator {{link}}');
      expect(await ensureTemplateLibrary()).toBe(0);
    } finally {
      await db.messageTemplate.update({ where: { id: original.id }, data: { body: original.body } });
    }
  });

  it('gives a step the operator adds a template that passes the launch check', async () => {
    await ensureTemplateLibrary();
    const c = await db.campaign.create({ data: { name: 'ZZ Template Library', vertical: 'Test', date: 'x', status: 'draft' } });
    made.push(c.id);
    const lib = await db.messageTemplate.findFirstOrThrow({ where: { campaignId: null, channel: 'email' }, select: { id: true } });
    await db.cadenceStep.create({
      data: { campaignId: c.id, key: 'custom-email-lib1', title: 'Registration', timing: 'Now', channel: 'Email', desc: 'x', group: 'Invitations & Outreach', trigger: 'launch', mode: 'ai', templateId: lib.id },
    });
    expect(await computeTemplatesReadiness(c.id)).toEqual({ ok: true, problems: [] });
  });
});
