'use server';

import { requireOperatorSession } from '@/lib/operatorSession';

import { db } from '@/lib/db';
import { saveWizardDraft, type SaveDraftInput, type SaveDraftResult } from '@/lib/wizardDraftServer';

/**
 * Autosave for the creation wizard. Writes our own database only (see lib/wizardDraftServer.ts); it never
 * calls Zoom, the CRM, an email gateway or the AI. Returns a status instead of throwing for the expected
 * cases (conflict, locked, gone) so the client can show the right message.
 */
export async function saveWizardDraftAction(input: SaveDraftInput): Promise<SaveDraftResult> {
  await requireOperatorSession();
  return saveWizardDraft(input);
}

/**
 * The draft's current revision. A wizard restored from the browser's back/forward cache can open with an
 * older copy of the page; comparing this with the revision the page was built at tells it to reload.
 */
export async function getDraftRevisionAction(campaignId: string): Promise<number | null> {
  await requireOperatorSession();
  if (typeof campaignId !== 'string' || campaignId.length > 64) return null;
  const row = await db.campaign.findUnique({ where: { id: campaignId }, select: { draftRevision: true } });
  return row ? row.draftRevision : null;
}

/**
 * The draft a creation token produced, if one was made. A copy of unsaved edits kept under "new" is only worth
 * offering back when no draft came of it: when the page was closed just as the draft was being created, the
 * server has the draft and the leftover copy would otherwise offer to create it a second time.
 */
export async function getDraftIdForTokenAction(token: string): Promise<string | null> {
  await requireOperatorSession();
  if (typeof token !== 'string' || token.length === 0 || token.length > 64) return null;
  const row = await db.appSetting.findUnique({ where: { key: `wizard.draft_token.${token}` } });
  const id = row?.value.split('|')[0];
  if (!id) return null;
  const draft = await db.campaign.findUnique({ where: { id }, select: { id: true } });
  return draft ? draft.id : null;
}
