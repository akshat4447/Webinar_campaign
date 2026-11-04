// Server-only. The complete Framer code component for a webinar: the landing page's form with the Studio script built in.
//
// Hand-maintained copies were the weak point: an address or webinar id typed into a component, or saved as one of its properties,
// outlived the tunnel or the webinar it named, and registrations went nowhere. So the file is generated here, from the same
// script Studio shows on the Registration screen, with the address and webinar written into the generated text and nowhere else.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { generateUniversalEmbedScript } from '@/lib/landingPage';

export interface FramerComponentOptions {
  /** Studio's public address, as people's browsers reach it. */
  apiOrigin: string;
  campaignId: string;
  zoomId?: string | null;
  /** The landing page address, so the script can tell the registration form from other forms on the site. */
  landingUrl?: string | null;
}

/** Text that goes between backticks in the generated file and reads back as exactly the original. */
export function escapeForTemplateLiteral(js: string): string {
  return js.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

/** The JavaScript of Studio's script for this webinar: what is between the script tags, nothing else. */
export function studioScriptSource(opts: FramerComponentOptions): string {
  const full = generateUniversalEmbedScript({
    apiOrigin: opts.apiOrigin,
    campaignId: opts.campaignId,
    zoomId: opts.zoomId ?? undefined,
    platform: 'framer',
    landingUrl: opts.landingUrl ?? undefined,
  });
  const m = /<script>([\s\S]*)<\/script>\s*$/.exec(full);
  if (!m) throw new Error('Studio script not in the expected shape.');
  return m[1].replace(/^\n+/, '').replace(/\s+$/, '\n');
}

export function generateFramerComponent(opts: FramerComponentOptions): string {
  let origin: string;
  try {
    const u = new URL(opts.apiOrigin);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
    origin = u.origin;
  } catch {
    throw new Error("Studio's address is not a valid web address.");
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(opts.campaignId)) throw new Error('That is not a webinar id.');
  const zoomId = /^[0-9 ]{1,20}$/.test(opts.zoomId ?? '') ? (opts.zoomId as string).trim() : '';

  const template = readFileSync(path.join(process.cwd(), 'lib', 'framerComponent.template.txt'), 'utf8');
  const script = escapeForTemplateLiteral(studioScriptSource({ ...opts, apiOrigin: origin, zoomId }));
  // A function as the replacement: the script is full of $ characters that a plain string would treat as patterns.
  return template
    .replace('__STUDIO_ORIGIN__', () => origin)
    .replace('__CAMPAIGN_ID__', () => opts.campaignId)
    .replace('__ZOOM_ID__', () => zoomId || '(none)')
    .replace('__STUDIO_SCRIPT__', () => script);
}
