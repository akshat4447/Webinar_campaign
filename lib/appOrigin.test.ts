import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { appOrigin } from './appOrigin';

describe('appOrigin', () => {
  beforeEach(() => {
    vi.stubEnv('APP_ORIGIN', undefined);
    vi.stubEnv('RENDER_EXTERNAL_URL', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('falls back to localhost:3000 when unset — dev and CLI scripts work with no configuration', () => {
    delete process.env.APP_ORIGIN;
    expect(appOrigin()).toBe('http://localhost:3000');
  });

  it('uses APP_ORIGIN when set', () => {
    process.env.APP_ORIGIN = 'https://webinars.example.com';
    expect(appOrigin()).toBe('https://webinars.example.com');
  });

  it('uses the assigned Render URL when APP_ORIGIN is unset', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://webinar-studio.onrender.com/';
    expect(appOrigin()).toBe('https://webinar-studio.onrender.com');
  });

  it('prefers a custom APP_ORIGIN over the assigned Render URL', () => {
    process.env.APP_ORIGIN = 'https://webinars.example.com/';
    process.env.RENDER_EXTERNAL_URL = 'https://webinar-studio.onrender.com';
    expect(appOrigin()).toBe('https://webinars.example.com');
  });

  it('strips a trailing slash, so callers can always append a path directly', () => {
    process.env.APP_ORIGIN = 'https://webinars.example.com/';
    expect(appOrigin()).toBe('https://webinars.example.com');
  });
});
