import { describe, expect, it } from 'vitest';
import { classifyHost, hostOf, isBetterHost } from './linkHost';

describe('classifyHost', () => {
  it('treats the free address a page builder hands out as shared', () => {
    for (const u of ['https://my-landing-page.framer.app/', 'https://my-site.framer.website/x?y=1', 'https://a.webflow.io', 'https://studio.onrender.com', 'https://x.pages.dev/', 'https://UPPER.Framer.App']) {
      expect(classifyHost(u), u).toBe('shared');
    }
  });
  it('treats tunnels, this machine, private networks, plain http and bare IPs as temporary', () => {
    for (const u of ['https://old-tunnel-name.trycloudflare.com', 'https://a.ngrok-free.app', 'https://x.loca.lt', 'http://localhost:3000', 'https://localhost', 'https://127.0.0.1:3101', 'https://192.168.0.6', 'https://172.20.1.1', 'http://studio.example.com', 'https://203.0.113.9', 'https://studio.internal', 'not a url at all', '', null, undefined]) {
      expect(classifyHost(u), String(u)).toBe('temporary');
    }
  });
  it('treats a domain someone chose as their own', () => {
    for (const u of ['https://webinar.leadsquared.com/', 'https://www.leadsquared.com/page?token=abc', 'https://studio.example.com', 'https://events.company.co.uk']) {
      expect(classifyHost(u), u).toBe('own');
    }
  });
  it('is not fooled by a free host named inside someone else\'s domain', () => {
    expect(classifyHost('https://framer.app.example.com/')).toBe('own');
    expect(classifyHost('https://notframer.app')).toBe('own');
    expect(classifyHost('https://example.com/?next=https://x.framer.app')).toBe('own');
    expect(classifyHost('https://example.com/trycloudflare.com')).toBe('own');
  });
  it('reads the host of an address with no scheme', () => {
    expect(hostOf('webinar.leadsquared.com/path')).toBe('webinar.leadsquared.com');
    expect(hostOf('')).toBe('');
  });
});

describe('isBetterHost', () => {
  const own = 'https://studio.leadsquared.com';
  const shared = 'https://my-site.framer.app';
  const tunnel = 'https://x.trycloudflare.com';
  it('is true only for a strictly more trustworthy address', () => {
    expect(isBetterHost(own, shared)).toBe(true);
    expect(isBetterHost(own, tunnel)).toBe(true);
    expect(isBetterHost(shared, tunnel)).toBe(true);
  });
  it('is false for an equal or worse one, so nothing switches for no reason', () => {
    expect(isBetterHost(own, 'https://webinar.example.org')).toBe(false);
    expect(isBetterHost(shared, 'https://other.framer.app')).toBe(false);
    expect(isBetterHost(tunnel, shared)).toBe(false);
    expect(isBetterHost(shared, own)).toBe(false);
    expect(isBetterHost('', own)).toBe(false);
  });
});
