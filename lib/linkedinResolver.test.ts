import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runLinkedInProfileResolver } from './linkedinResolver';
import { db } from './db';

vi.mock('./db', () => ({
  db: {
    contact: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('./integrationConfig', () => ({
  resolveIntegrationField: vi.fn().mockResolvedValue(''),
}));

vi.mock('./apolloVerify', () => ({
  enrichContactsViaApollo: vi.fn().mockResolvedValue({ results: new Map(), usedLiveApi: false }),
}));

describe('runLinkedInProfileResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles empty contact list gracefully', async () => {
    vi.mocked(db.contact.findMany).mockResolvedValue([]);
    const res = await runLinkedInProfileResolver('camp-1');
    expect(res.ok).toBe(true);
    expect(res.totalContacts).toBe(0);
  });

  it('detects existing valid LinkedIn profile slugs', async () => {
    vi.mocked(db.contact.findMany).mockResolvedValue([
      {
        id: 'c-1',
        name: 'Satya Nadella',
        title: 'CEO',
        account: 'Microsoft',
        linkedinId: 'satyanadella',
        extraFieldsJson: null,
      },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const res = await runLinkedInProfileResolver('camp-1');
    expect(res.ok).toBe(true);
    expect(res.totalContacts).toBe(1);
    expect(res.alreadyHadProfile).toBe(1);
    expect(res.resolvedFromExtras).toBe(0);
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('extracts and normalizes LinkedIn profile from extraFieldsJson LeadSquared attributes', async () => {
    vi.mocked(db.contact.findMany).mockResolvedValue([
      {
        id: 'c-2',
        name: 'Priya Nair',
        title: 'VP Engineering',
        account: 'Acme',
        linkedinId: null,
        extraFieldsJson: JSON.stringify({
          mx_LinkedIn_Profile: 'https://in.linkedin.com/in/priya-nair-tech',
        }),
      },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    vi.mocked(db.contact.update).mockImplementation((args) => args as unknown as ReturnType<typeof db.contact.update>);
    vi.mocked(db.$transaction).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof db.$transaction>>);

    const res = await runLinkedInProfileResolver('camp-1');
    expect(res.ok).toBe(true);
    expect(res.totalContacts).toBe(1);
    expect(res.resolvedFromExtras).toBe(1);
    expect(db.$transaction).toHaveBeenCalledWith([
      db.contact.update({
        where: { id: 'c-2' },
        data: { linkedinId: 'priya-nair-tech' },
      }),
    ]);
  });

  it('falls back to search when no profile exists anywhere', async () => {
    vi.mocked(db.contact.findMany).mockResolvedValue([
      {
        id: 'c-3',
        name: 'Alex Rivera',
        title: 'Director',
        account: 'Stripe',
        linkedinId: null,
        extraFieldsJson: null,
      },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const res = await runLinkedInProfileResolver('camp-1');
    expect(res.ok).toBe(true);
    expect(res.totalContacts).toBe(1);
    expect(res.alreadyHadProfile).toBe(0);
    expect(res.resolvedFromExtras).toBe(0);
    expect(res.fallbackToSearch).toBe(1);
    expect(db.$transaction).not.toHaveBeenCalled();
  });
});
