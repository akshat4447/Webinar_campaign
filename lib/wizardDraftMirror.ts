'use client';

import { isEmptyPatch, sanitizeDraftPatch, type DraftPatch } from '@/lib/wizardDraft';

// An on-device copy of edits the server has not confirmed yet. It is the safety net for a crash, a closed
// laptop or a failed save: on the next visit the wizard offers to restore it. It holds wizard fields only,
// never credentials or tokens, and every read and write is guarded because storage can be blocked, full or
// absent (private windows, embedded previews).

export interface Mirror {
  patch: DraftPatch;
  baseRevision: number;
  step: number;
  /** The token the draft's creation was (or will be) sent with, so a leftover copy can be checked against the server. */
  createToken?: string;
  savedAt: number;
}

const key = (campaignId: string | null) => `wizard-draft:${campaignId ?? 'new'}`;

export function writeMirror(campaignId: string | null, mirror: Omit<Mirror, 'savedAt'>, now = Date.now()): void {
  try {
    if (isEmptyPatch(mirror.patch)) {
      window.localStorage.removeItem(key(campaignId));
      return;
    }
    window.localStorage.setItem(key(campaignId), JSON.stringify({ ...mirror, savedAt: now }));
  } catch {
    /* storage unavailable: the server copy is still the source of truth */
  }
}

export function readMirror(campaignId: string | null): Mirror | null {
  try {
    const raw = window.localStorage.getItem(key(campaignId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Mirror>;
    // Re-sanitised on the way in: a stored value is input like any other.
    const patch = sanitizeDraftPatch(v.patch);
    if (isEmptyPatch(patch)) return null;
    return {
      patch,
      baseRevision: typeof v.baseRevision === 'number' ? v.baseRevision : 0,
      step: typeof v.step === 'number' ? v.step : 0,
      createToken: typeof v.createToken === 'string' ? v.createToken.slice(0, 64) : undefined,
      savedAt: typeof v.savedAt === 'number' ? v.savedAt : 0,
    };
  } catch {
    return null;
  }
}

export function clearMirror(campaignId: string | null): void {
  try {
    window.localStorage.removeItem(key(campaignId));
  } catch {
    /* ignore */
  }
}
