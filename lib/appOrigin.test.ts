import { describe, it, expect, afterEach } from 'vitest';
import { appOrigin } from './appOrigin';

describe('appOrigin', () => {
  const original = process.env.APP_ORIGIN;

  afterEach(() => {
    if (original === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = original;
  });

  it('falls back to localhost:3000 when unset — dev and CLI scripts work with no configuration', () => {
    delete process.env.APP_ORIGIN;
    expect(appOrigin()).toBe('http://localhost:3000');
  });

  it('uses APP_ORIGIN when set', () => {
    process.env.APP_ORIGIN = 'https://webinars.example.com';
    expect(appOrigin()).toBe('https://webinars.example.com');
  });

  it('strips a trailing slash, so callers can always append a path directly', () => {
    process.env.APP_ORIGIN = 'https://webinars.example.com/';
    expect(appOrigin()).toBe('https://webinars.example.com');
  });
});
