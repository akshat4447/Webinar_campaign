// The Messaging tab says how many personalized copies fail validation. A step that has already sent is a record of
// what went out, so only copies still waiting to be sent can count against the webinar.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Db = typeof import('@/lib/db')['db'];
let db: Db;
let computePersonalizeReadiness: typeof import('@/lib/cadenceReadiness')['computePersonalizeReadiness'];
let campaignId = '';
const contacts: string[] = [];

beforeAll(async () => {
  db = (await import('@/lib/db')).db;
  computePersonalizeReadiness = (await import('@/lib/cadenceReadiness')).computePersonalizeReadiness;
  const { provisionCampaignDefaults } = await import('@/lib/campaignDefaults');
  const campaign = await db.campaign.create({
    data: { name: 'ZZ Personalize Readiness', vertical: 'Test', date: 'x', registrationLink: 'https://lp.example.com/webinar', registrationMode: 'external', oneClickSignup: false },
  });
  campaignId = campaign.id;
  await provisionCampaignDefaults(campaignId);
  // One enabled step with a valid template of its own, so the only thing that can be wrong is a personalized copy.
  await db.cadenceStep.updateMany({ where: { campaignId, key: { not: 'invite' } }, data: { enabled: false } });
  await db.cadenceStep.updateMany({ where: { campaignId, key: 'invite' }, data: { enabled: true } });
  await db.messageTemplate.create({
    data: { campaignId, channel: 'email', key: 'invite', name: 'Initial invite', hasSubject: true, subject: 'Join {{topic}}', body: 'Hi {{firstName}}, join us for {{topic}}: {{link}}', status: 'ready' },
  });
  for (const n of [1, 2]) {
    const c = await db.contact.create({ data: { campaignId, name: `Person ${n}`, email: `ready${n}@example.com`, account: 'Acme', vertical: 'Test', title: 'VP', function: 'Ops', seniority: 'VP', approved: true, score: 80 } });
    contacts.push(c.id);
    // A copy with no body and no link: it fails validation.
    await db.personalizedMessage.create({ data: { campaignId, contactId: c.id, stepKey: 'invite', channel: 'email', subject: '', body: '' } });
  }
});

afterAll(async () => {
  await db.campaign.delete({ where: { id: campaignId } }).catch(() => undefined);
  await db.$disconnect();
});

const failing = async () => (await computePersonalizeReadiness(campaignId)).problems.filter((p) => /failed validation/.test(p));

describe('computePersonalizeReadiness', () => {
  it('counts every invalid copy while none has been sent', async () => {
    expect(await failing()).toEqual([expect.stringMatching(/^Initial invite: 2 personalized copies failed validation/)]);
  });

  it('stops counting a copy once it has been sent, and counts the ones still waiting', async () => {
    await db.cadenceSend.create({ data: { campaignId, contactId: contacts[0], stepKey: 'invite', dueAt: new Date(), status: 'sent', sentAt: new Date() } });
    expect(await failing()).toEqual([expect.stringMatching(/^Initial invite: 1 personalized copy failed validation/)]);
  });

  it('reports nothing for a step that has sent to everyone', async () => {
    await db.cadenceSend.create({ data: { campaignId, contactId: contacts[1], stepKey: 'invite', dueAt: new Date(), status: 'sent', sentAt: new Date() } });
    expect(await failing()).toEqual([]);
  });

  it('does not let a failed or queued send hide an invalid copy', async () => {
    await db.cadenceSend.updateMany({ where: { campaignId, contactId: contacts[1] }, data: { status: 'queued', sentAt: null } });
    expect(await failing()).toEqual([expect.stringMatching(/1 personalized copy failed validation/)]);
  });
});
