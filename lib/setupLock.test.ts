import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({ db: { campaign: { findUnique: vi.fn() }, cadenceSend: { count: vi.fn() } } }));

import { db } from '@/lib/db';
import { setupLockError, assertSetupEditable, SETUP_LOCKED_MESSAGE, stepSentError, assertStepUnsent, STEP_SENT_MESSAGE } from './setupLock';

const find = db.campaign.findUnique as unknown as ReturnType<typeof vi.fn>;
beforeEach(() => vi.clearAllMocks());

describe('setupLock', () => {
  it('allows editing before launch', async () => {
    find.mockResolvedValue({ status: 'draft', cadenceStatus: 'not_started' });
    expect(await setupLockError('c1')).toBeNull();
    await expect(assertSetupEditable('c1')).resolves.toBeUndefined();
  });
  it('blocks editing after launch', async () => {
    find.mockResolvedValue({ status: 'live', cadenceStatus: 'running' });
    expect(await setupLockError('c1')).toBe(SETUP_LOCKED_MESSAGE);
    await expect(assertSetupEditable('c1')).rejects.toThrow(/launched/);
  });
  it('blocks editing when the lookup fails or the webinar is missing', async () => {
    find.mockRejectedValueOnce(new Error('db down'));
    expect(await setupLockError('c1')).toContain('Could not verify');
    find.mockResolvedValueOnce(null);
    expect(await setupLockError('missing')).toContain('not found');
  });
});

describe('step lock', () => {
  const count = db.cadenceSend.count as unknown as ReturnType<typeof vi.fn>;
  it('locks a step once anything has sent', async () => {
    count.mockResolvedValue(3);
    expect(await stepSentError('c1', 'invite')).toBe(STEP_SENT_MESSAGE);
    await expect(assertStepUnsent('c1', 'invite')).rejects.toThrow(/already sent/);
  });
  it('leaves an unsent step editable and blocks on a lookup error', async () => {
    count.mockResolvedValueOnce(0);
    expect(await stepSentError('c1', 'nudge')).toBeNull();
    count.mockRejectedValueOnce(new Error('db down'));
    expect(await stepSentError('c1', 'nudge')).toContain('Could not verify');
  });
});

describe('guarded actions reject on a launched webinar', () => {
  it('registration settings return the lock message instead of saving', async () => {
    vi.resetModules();
    vi.doMock('@/lib/db', () => ({ db: { campaign: { findUnique: vi.fn().mockResolvedValue({ status: 'live', cadenceStatus: 'running' }), update: vi.fn() } } }));
    vi.doMock('@/lib/revalidate', () => ({ revalidateCampaign: vi.fn() }));
    vi.doMock('@/lib/integrationConfig', () => ({ resolveIntegrationField: vi.fn() }));
    vi.doMock('@/lib/zoom/client', () => ({ zoomConnectionError: vi.fn() }));
    vi.doMock('@/lib/actions/zoom', () => ({ getZoomRegistrationHealthAction: vi.fn() }));
    const { saveRegistrationSettingsAction } = await import('./actions/registration');
    const res = await saveRegistrationSettingsAction('c1', { mode: 'zoom' });
    expect(res).toEqual({ ok: false, error: SETUP_LOCKED_MESSAGE });
    const { db: mockedDb } = await import('@/lib/db');
    expect((mockedDb.campaign as unknown as { update: ReturnType<typeof vi.fn> }).update).not.toHaveBeenCalled();
  }, 30_000); // loads the whole registration action module graph on a cold cache
});
