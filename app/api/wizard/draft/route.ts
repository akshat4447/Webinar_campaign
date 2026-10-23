import { NextRequest, NextResponse } from 'next/server';
import { saveWizardDraft } from '@/lib/wizardDraftServer';
import { requestOrigin } from '@/lib/requestOrigin';
import { allowRequest, clientIp } from '@/lib/rateLimit';
import { requireOperatorSession } from '@/lib/operatorSession';

// Unload-safe twin of saveWizardDraftAction. A server action is cancelled when the page unloads, but a
// `keepalive` fetch or sendBeacon survives it, so the wizard posts its last unsaved edits here from
// `pagehide`. Same patch contract and the same implementation as the action.

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 256 * 1024;
const LIMIT = { limit: 120, windowMs: 60_000 };


const json = (body: Record<string, unknown>, status: number, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: extra });

/** Same-site callers only: this route writes drafts, so a page on another origin must not be able to post to it. */
function isSameSite(req: NextRequest): boolean {
  const fetchSite = req.headers.get('sec-fetch-site');
  if (fetchSite) return fetchSite === 'same-origin';
  const origin = req.headers.get('origin');
  return !!origin && origin === requestOrigin(req);
}

export async function POST(req: NextRequest) {
  try { await requireOperatorSession(); } catch { return json({ status: 'unauthorized' }, 401); }
  if (!isSameSite(req)) return json({ status: 'forbidden' }, 403);

  // Refuse an oversized body before reading it, then again after (a chunked body has no declared length).
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json({ status: 'too_large' }, 413);
  const text = await req.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_BODY_BYTES) return json({ status: 'too_large' }, 413);
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as Record<string, unknown>;
  } catch {
    return json({ status: 'bad_request' }, 400);
  }

  const campaignId = typeof body.campaignId === 'string' ? body.campaignId.slice(0, 64) : null;
  // Keyed by caller only: a key that includes a client-chosen id would give every made-up id its own allowance.
  const limited = await allowRequest({ scope: 'wizard-draft', key: clientIp(req.headers), ...LIMIT });
  if (!limited.allowed) return json({ status: 'rate_limited' }, 429, { 'Retry-After': String(limited.retryAfterSec) });

  try {
    const result = await saveWizardDraft({
      campaignId,
      step: typeof body.step === 'number' ? body.step : 0,
      patch: body.patch,
      baseRevision: typeof body.baseRevision === 'number' ? body.baseRevision : 0,
      groupBases: body.groupBases as Record<string, number> | undefined,
      createToken: typeof body.createToken === 'string' ? body.createToken.slice(0, 64) : undefined,
    });
    return json(result, 200);
  } catch (err) {
    console.error('[wizard-draft] save failed:', err instanceof Error ? err.message : err);
    return json({ status: 'error' }, 500);
  }
}
