import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEnrichmentPreflight, DEFAULT_FIELD_SELECTION } from '@/lib/enrichment';
import { db } from '@/lib/db';

describe('Checkpoint 5: Moderated Enrichment Preflight & Scope', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(db.appSetting, 'findMany').mockResolvedValue([]);
    vi.spyOn(db.appSetting, 'findUnique').mockResolvedValue(null);
  });
  it('calculates exact preflight usage and estimated costs', async () => {
    vi.spyOn(db.contact, 'findMany').mockResolvedValue([
      { id: '1', email: 'alice@acme.com', phone: '+1234567890', title: 'VP Sales', account: 'Acme' },
      { id: '2', email: null, phone: null, title: '—', account: 'Beta Corp' },
      { id: '3', email: 'charlie@acme.com', phone: null, title: 'Director', account: 'Acme' },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    const preflight = await getEnrichmentPreflight('camp-1', {
      apolloEmail: true,
      apolloPhone: true,
      apolloTitle: true,
      claudePersona: true,
    });

    expect(preflight.totalContacts).toBe(3);
    expect(preflight.missingEmail).toBe(1);
    expect(preflight.missingPhone).toBe(2);
    expect(preflight.missingTitle).toBe(1);
    expect(preflight.uniqueAccounts).toBe(2); // 'acme' and 'beta corp'
    expect(preflight.estimatedApolloCredits).toBe(2); // Contact 2 (missing email, phone, title) and Contact 3 (missing phone)
    expect(preflight.estimatedClaudeTokens).toBe(3 * 150);
  });

  it('adjusts estimates when specific fields are disabled', async () => {
    vi.spyOn(db.contact, 'findMany').mockResolvedValue([
      { id: '1', email: 'alice@acme.com', phone: null, title: 'VP Sales', account: 'Acme' },
      { id: '2', email: null, phone: null, title: 'Director', account: 'Beta Corp' },
    ] as unknown as Awaited<ReturnType<typeof db.contact.findMany>>);

    // Disable phone and Claude persona
    const preflight = await getEnrichmentPreflight('camp-1', {
      apolloEmail: true,
      apolloPhone: false,
      apolloTitle: false,
      claudePersona: false,
    });

    expect(preflight.estimatedApolloCredits).toBe(1); // Only contact 2 needs email
    expect(preflight.estimatedClaudeTokens).toBe(0); // Claude disabled
  });

  it('provides complete default field selections', () => {
    expect(DEFAULT_FIELD_SELECTION.apolloEmail).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.apolloPhone).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.apolloTitle).toBe(true);
    expect(DEFAULT_FIELD_SELECTION.claudePersona).toBe(true);
  });
});
