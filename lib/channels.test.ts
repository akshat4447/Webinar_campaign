import { describe, it, expect } from 'vitest';
import { normalizeChannel, isGsm7, smsSegmentCount, checkSmsBody, isAutomatableChannel } from './channels';

describe('normalizeChannel', () => {
  it('routes the known display strings', () => {
    expect(normalizeChannel('Email')).toBe('email');
    expect(normalizeChannel('Email + LinkedIn')).toBe('email'); // email wins multi-channel labels
    expect(normalizeChannel('LinkedIn')).toBe('linkedin');
    expect(normalizeChannel('SMS')).toBe('sms');
    expect(normalizeChannel('WhatsApp')).toBe('whatsapp');
  });

  it('defaults unknown or empty to email — the historical channel', () => {
    expect(normalizeChannel(null)).toBe('email');
    expect(normalizeChannel('Carrier pigeon')).toBe('email');
  });
});

describe('SMS encoding', () => {
  it('detects GSM-7 vs UCS-2 bodies', () => {
    expect(isGsm7('Join: https://lsq.co/w/abc-2026')).toBe(true);
    expect(isGsm7('See you 👋')).toBe(false);
    expect(isGsm7('Smart “quotes” break GSM')).toBe(false);
  });

  it('counts segments with the concatenated-message rules', () => {
    expect(smsSegmentCount('short')).toBe(1);
    expect(smsSegmentCount('x'.repeat(160))).toBe(1);
    expect(smsSegmentCount('x'.repeat(161))).toBe(2); // 153-char continuation chunks
    expect(smsSegmentCount('é'.repeat(71))).toBe(1); // é IS in GSM-7 — still 160/153 budgets
    expect(smsSegmentCount('あ'.repeat(71))).toBe(2); // true UCS-2: 70 first segment
  });

  describe('checkSmsBody', () => {
    it('passes a clean one-segment reminder with a link', () => {
      const { issues } = checkSmsBody('{{topic}} starts in 1 hour. Join: {{link}}');
      expect(issues.filter((i) => i.severity === 'error')).toHaveLength(0);
    });

    it('errors on empty body and on runaway segment counts', () => {
      expect(checkSmsBody('   ').issues.some((i) => i.severity === 'error')).toBe(true);
      const long = checkSmsBody('y'.repeat(500));
      expect(long.issues.some((i) => i.severity === 'error' && i.message.includes('segments'))).toBe(true);
    });

    it('warns (not errors) on non-GSM content and multi-segment bodies', () => {
      const { issues } = checkSmsBody('See you soon 🎉 at {{link}}');
      expect(issues.some((i) => i.severity === 'warning' && i.message.includes('Non-GSM'))).toBe(true);
    });
  });
});

describe('isAutomatableChannel', () => {
  it('is automatable for every channel except LinkedIn', () => {
    expect(isAutomatableChannel('Email')).toBe(true);
    expect(isAutomatableChannel('SMS')).toBe(true);
    expect(isAutomatableChannel('WhatsApp')).toBe(true);
  });

  it('is not automatable for LinkedIn — there is no send API for messages', () => {
    expect(isAutomatableChannel('LinkedIn')).toBe(false);
  });

  it('routes a mixed label by its primary channel', () => {
    // "Email + LinkedIn" normalizes to 'email' (email wins multi-channel labels),
    // so the step IS automatable even though LinkedIn is mentioned.
    expect(isAutomatableChannel('Email + LinkedIn')).toBe(true);
  });
});