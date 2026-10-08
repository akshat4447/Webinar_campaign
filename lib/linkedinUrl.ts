// Pure helpers — safe on both client and server, no DB or env access.
//
// LinkedIn has no messaging API for general apps and no URL parameter that
// prefills a message body, so the app can only ever get the user *to* the right
// place with the text on their clipboard. These build those destinations.

/**
 * Pulls the profile slug out of whatever someone pasted. Accepts a full URL, a
 * bare `linkedin.com/in/x`, a locale-subdomain URL, or a plain slug. Returns
 * null when the input doesn't look like a profile reference at all, so callers
 * can fall back to a people-search rather than building a broken link.
 */
export function normalizeLinkedInSlug(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  // Strip protocol and any domain (e.g. www.linkedin.com, in.linkedin.com, uk.linkedin.com), keeping whatever follows /in/.
  const inMatch = s.match(/(?:[a-z]{2,3}\.)?linkedin\.com\/in\/([^/?#]+)/i);
  if (inMatch) {
    s = inMatch[1];
  } else if (/[/?#]|linkedin\.com/i.test(s)) {
    // Looks like a URL or a LinkedIn link, but not a /in/ profile one
    // (company page, feed post, search results…). Not usable as a recipient.
    return null;
  }

  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep unescaped */
  }
  s = s.trim().replace(/^@/, '').replace(/\/+$/, '');
  // Profile slugs are letters, digits, dots, hyphens, and underscores; anything with whitespace or prohibited punctuation isn't one.
  if (!s || /\s/.test(s) || !/^[\p{L}\p{N}._-]+$/u.test(s)) return null;
  return s;
}

/**
 * Opens LinkedIn's message composer aimed at one person. Undocumented but
 * long-standing; it can land on messaging home instead of a targeted composer
 * when you aren't connected to them, which is why callers should also offer
 * the plain profile URL.
 */
export function composeUrl(slug: string): string {
  return `https://www.linkedin.com/messaging/compose/?recipient=${encodeURIComponent(slug)}`;
}

export function profileUrl(slug: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}

/** Fallback when no profile is on file — a real search for that name at that company. */
export function peopleSearchUrl(name: string, account: string): string {
  const query = [name.trim(), account.trim()].filter(Boolean).join(' ');
  return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query || 'participant')}`;
}

export interface LinkedInDestination {
  url: string;
  kind: 'profile' | 'search';
  slug?: string;
}

/**
 * Deterministically resolves the best destination for a contact:
 * returns a direct profile URL if a valid slug is present, or a people-search URL fallback.
 */
export function resolveLinkedInDestination(contact: {
  name?: string | null;
  account?: string | null;
  linkedinId?: string | null;
}): LinkedInDestination {
  const slug = normalizeLinkedInSlug(contact.linkedinId);
  if (slug) {
    return {
      url: profileUrl(slug),
      kind: 'profile',
      slug,
    };
  }
  return {
    url: peopleSearchUrl(contact.name || '', contact.account || ''),
    kind: 'search',
  };
}
