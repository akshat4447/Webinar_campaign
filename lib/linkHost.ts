// Pure. How much a web address can be trusted to appear in a message people receive, judged from its host alone.
//
// Mail filters judge a link by where it points. A personal link to a free address that comes with a page builder
// (my-site.framer.app) was held back by a company mail gateway in testing, the same link on the company's own domain
// was not, and neither was one to a throwaway tunnel address. Studio uses this to put the most trustworthy of the
// addresses it has into a message (see buildInviteLink).

export type HostClass =
  /** A domain someone owns and chose. */
  | 'own'
  /** The free address a page builder or host gives every site: shared with thousands of others. */
  | 'shared'
  /** Works for a test only: a tunnel, this machine, a private network, or a page that is not served over https. */
  | 'temporary';

const SHARED_HOSTS = /(^|\.)(framer\.(app|website|ai)|webflow\.io|wixsite\.com|carrd\.co|netlify\.app|vercel\.app|pages\.dev|github\.io|onrender\.com|herokuapp\.com|replit\.app|my\.canva\.site|godaddysites\.com|weebly\.com|squarespace\.com|notion\.site)$/i;
const TUNNEL_HOSTS = /(^|\.)(trycloudflare\.com|ngrok-free\.app|ngrok\.io|ngrok\.app|loca\.lt|localtunnel\.me|serveo\.net)$/i;
const THIS_MACHINE = /^(localhost|.*\.localhost|.*\.local|.*\.internal|\[?::1\]?)$/i;
const PRIVATE_IP = /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/;

export function hostOf(url: string | null | undefined): string {
  const raw = (url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Anything that is not clearly a free or temporary address counts as the person's own: Studio cannot tell, and a custom domain is the common case. */
export function classifyHost(url: string | null | undefined): HostClass {
  const raw = (url ?? '').trim();
  const host = hostOf(raw);
  if (!host) return 'temporary';
  if (/^http:\/\//i.test(raw)) return 'temporary';
  if (THIS_MACHINE.test(host) || PRIVATE_IP.test(host) || TUNNEL_HOSTS.test(host)) return 'temporary';
  // A bare IP address is never a domain someone chose.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return 'temporary';
  if (SHARED_HOSTS.test(host)) return 'shared';
  return 'own';
}

const RANK: Record<HostClass, number> = { temporary: 0, shared: 1, own: 2 };

/** True only when `candidate` is a more trustworthy address than `current`: an equal one is not worth switching to. */
export function isBetterHost(candidate: string | null | undefined, current: string | null | undefined): boolean {
  return RANK[classifyHost(candidate)] > RANK[classifyHost(current)];
}
