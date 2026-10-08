import { describe, it, expect } from 'vitest';
import { computeZoomSignature, verifyZoomSignature, zoomCrcResponse, ZOOM_TIMESTAMP_TOLERANCE_SEC } from './webhookSecurity';

const secret = 'zoom_secret_token';
const body = '{"event":"meeting.ended"}';
const nowMs = 1_800_000_000_000;
const ts = String(Math.floor(nowMs / 1000));

describe('verifyZoomSignature', () => {
  it('accepts a correctly signed, fresh request', () => {
    const signature = computeZoomSignature(secret, ts, body);
    expect(verifyZoomSignature({ secret, rawBody: body, signature, timestamp: ts, nowMs })).toEqual({ ok: true });
  });

  it('matches the documented v0 construction', () => {
    expect(computeZoomSignature(secret, ts, body)).toMatch(/^v0=[0-9a-f]{64}$/);
  });

  it('rejects missing headers', () => {
    expect(verifyZoomSignature({ secret, rawBody: body, signature: null, timestamp: ts, nowMs })).toEqual({ ok: false, reason: 'missing-headers' });
    expect(verifyZoomSignature({ secret, rawBody: body, signature: 'v0=x', timestamp: null, nowMs })).toEqual({ ok: false, reason: 'missing-headers' });
  });

  it('rejects a tampered body', () => {
    const signature = computeZoomSignature(secret, ts, body);
    expect(verifyZoomSignature({ secret, rawBody: body + ' ', signature, timestamp: ts, nowMs })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a signature made with a different secret', () => {
    const signature = computeZoomSignature('other', ts, body);
    expect(verifyZoomSignature({ secret, rawBody: body, signature, timestamp: ts, nowMs })).toEqual({ ok: false, reason: 'bad-signature' });
  });

  it('rejects a stale (replayed) timestamp even when the signature is valid', () => {
    const old = String(Math.floor(nowMs / 1000) - ZOOM_TIMESTAMP_TOLERANCE_SEC - 1);
    const signature = computeZoomSignature(secret, old, body);
    expect(verifyZoomSignature({ secret, rawBody: body, signature, timestamp: old, nowMs })).toEqual({ ok: false, reason: 'stale-timestamp' });
  });

  it('rejects a non-numeric timestamp and a wrong-length signature without throwing', () => {
    expect(verifyZoomSignature({ secret, rawBody: body, signature: 'v0=abc', timestamp: 'abc', nowMs })).toEqual({ ok: false, reason: 'stale-timestamp' });
    expect(verifyZoomSignature({ secret, rawBody: body, signature: 'short', timestamp: ts, nowMs })).toEqual({ ok: false, reason: 'bad-signature' });
  });
});

describe('zoomCrcResponse', () => {
  it('echoes the plain token with its HMAC-SHA256 hex digest', () => {
    const res = zoomCrcResponse(secret, 'abc123');
    expect(res.plainToken).toBe('abc123');
    expect(res.encryptedToken).toMatch(/^[0-9a-f]{64}$/);
  });
});
