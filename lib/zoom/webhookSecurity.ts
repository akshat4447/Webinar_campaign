// Pure helpers for Zoom webhook authenticity. No I/O so every rule is unit-tested.
//
// Zoom signs each event as:  v0=HMAC_SHA256(secretToken, `v0:${x-zm-request-timestamp}:${rawBody}`)
// and sends it in `x-zm-signature`. The endpoint-validation (CRC) challenge is
// answered with HMAC_SHA256(secretToken, plainToken).

import { createHmac, timingSafeEqual } from 'node:crypto';

/** Zoom's own guidance is to reject stale timestamps to blunt replays. */
export const ZOOM_TIMESTAMP_TOLERANCE_SEC = 5 * 60;

export type ZoomSignatureResult = { ok: true } | { ok: false; reason: 'missing-headers' | 'stale-timestamp' | 'bad-signature' };

export function computeZoomSignature(secret: string, timestamp: string, rawBody: string): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${rawBody}`).digest('hex')}`;
}

export function verifyZoomSignature(args: {
  secret: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  /** Injectable clock for tests. */
  nowMs?: number;
}): ZoomSignatureResult {
  const { secret, rawBody, signature, timestamp } = args;
  if (!signature || !timestamp) return { ok: false, reason: 'missing-headers' };

  const ts = Number(timestamp);
  const nowSec = Math.floor((args.nowMs ?? Date.now()) / 1000);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > ZOOM_TIMESTAMP_TOLERANCE_SEC) return { ok: false, reason: 'stale-timestamp' };

  const expected = Buffer.from(computeZoomSignature(secret, timestamp, rawBody), 'utf8');
  const provided = Buffer.from(signature, 'utf8');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return { ok: false, reason: 'bad-signature' };
  return { ok: true };
}

export function zoomCrcResponse(secret: string, plainToken: string): { plainToken: string; encryptedToken: string } {
  return { plainToken, encryptedToken: createHmac('sha256', secret).update(plainToken).digest('hex') };
}
