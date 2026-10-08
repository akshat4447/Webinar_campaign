import { describe, it, expect, vi, beforeEach } from 'vitest';

const markers = new Map<string, string>();
const campaigns = new Map<string, { attendanceImportedAt: Date | null }>();

vi.mock('@/lib/db', () => ({
  db: {
    appSetting: {
      upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: string } }) => {
        markers.set(where.key, create.value);
      }),
      findMany: vi.fn(async ({ where }: { where: { key: { startsWith: string } } }) =>
        [...markers].filter(([k]) => k.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value }))
      ),
      deleteMany: vi.fn(async ({ where }: { where: { key: string } }) => {
        markers.delete(where.key);
      }),
    },
    campaign: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => campaigns.get(where.id) ?? null) },
  },
}));

const importAttendanceFromZoom = vi.fn();
vi.mock('@/lib/attendance', () => ({ importAttendanceFromZoom: (...a: unknown[]) => importAttendanceFromZoom(...a) }));

import { markMeetingEnded, importEndedMeetingsDue, ENDED_SETTLE_MS, ENDED_GIVE_UP_MS } from './zoomEnded';

const endedAt = new Date('2026-10-01T10:00:00Z');
const after = (ms: number) => new Date(endedAt.getTime() + ms);

beforeEach(() => {
  markers.clear();
  campaigns.clear();
  importAttendanceFromZoom.mockReset();
});

describe('importEndedMeetingsDue', () => {
  it('waits out the settle delay before importing', async () => {
    campaigns.set('c1', { attendanceImportedAt: null });
    await markMeetingEnded('c1', endedAt);
    const s = await importEndedMeetingsDue(after(ENDED_SETTLE_MS - 1000));
    expect(s).toMatchObject({ checked: 1, waiting: 1, imported: 0 });
    expect(importAttendanceFromZoom).not.toHaveBeenCalled();
  });

  it('imports once settled and clears the marker', async () => {
    campaigns.set('c1', { attendanceImportedAt: null });
    importAttendanceFromZoom.mockResolvedValue({ ok: true });
    await markMeetingEnded('c1', endedAt);
    const s = await importEndedMeetingsDue(after(ENDED_SETTLE_MS + 1000));
    expect(s.imported).toBe(1);
    expect(importAttendanceFromZoom).toHaveBeenCalledWith('c1');
    expect(markers.size).toBe(0);
  });

  it('keeps the marker and retries next tick when Zoom has no participants yet', async () => {
    campaigns.set('c1', { attendanceImportedAt: null });
    importAttendanceFromZoom.mockResolvedValue({ ok: false, error: 'no participants' });
    await markMeetingEnded('c1', endedAt);
    const s = await importEndedMeetingsDue(after(ENDED_SETTLE_MS + 1000));
    expect(s).toMatchObject({ imported: 0, waiting: 1 });
    expect(markers.size).toBe(1);
  });

  it('survives a throwing import and still processes the other campaigns', async () => {
    campaigns.set('bad', { attendanceImportedAt: null });
    campaigns.set('good', { attendanceImportedAt: null });
    importAttendanceFromZoom.mockImplementation(async (id: string) => {
      if (id === 'bad') throw new Error('boom');
      return { ok: true };
    });
    await markMeetingEnded('bad', endedAt);
    await markMeetingEnded('good', endedAt);
    const s = await importEndedMeetingsDue(after(ENDED_SETTLE_MS + 1000));
    expect(s.imported).toBe(1);
    expect(markers.has('zoom.ended.bad')).toBe(true);
  });

  it('drops markers for campaigns already imported, deleted, or past the give-up window', async () => {
    campaigns.set('done', { attendanceImportedAt: new Date() });
    campaigns.set('stuck', { attendanceImportedAt: null });
    await markMeetingEnded('done', endedAt);
    await markMeetingEnded('gone', endedAt);
    await markMeetingEnded('stuck', endedAt);
    const s = await importEndedMeetingsDue(after(ENDED_GIVE_UP_MS + 1000));
    expect(importAttendanceFromZoom).not.toHaveBeenCalled();
    expect(s.gaveUp).toBe(1);
    expect(markers.size).toBe(0);
  });
});
