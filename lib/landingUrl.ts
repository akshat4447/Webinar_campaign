// Pure. Validation + normalisation of the landing-page URL an operator types in.

export interface LandingUrlResult {
  ok: boolean;
  /** Normalised absolute URL (https added when missing), only when ok. */
  url?: string;
  error?: string;
  /** Things worth knowing that do not block saving. */
  warnings: string[];
}

const MAX_LEN = 2048;

export function validateLandingUrl(raw: string | null | undefined): LandingUrlResult {
  const input = (raw ?? '').trim();
  if (!input) return { ok: false, error: 'Enter the landing page address.', warnings: [] };
  if (input.length > MAX_LEN) return { ok: false, error: 'That address is too long.', warnings: [] };
  if (/\s/.test(input)) return { ok: false, error: 'The address cannot contain spaces.', warnings: [] };
  if (/^(javascript|data|vbscript|file|blob):/i.test(input)) return { ok: false, error: 'Only http and https addresses are allowed.', warnings: [] };
  if (/^[a-z][a-z0-9+.-]*:/i.test(input) && !/^https?:\/\//i.test(input)) return { ok: false, error: 'Only http and https addresses are allowed.', warnings: [] };

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return { ok: false, error: 'That does not look like a web address.', warnings: [] };
  }
  if (url.username || url.password) return { ok: false, error: 'Remove the username and password from the address.', warnings: [] };
  if (!url.hostname.includes('.') && url.hostname !== 'localhost') return { ok: false, error: 'The address needs a domain, like webinar.example.com.', warnings: [] };

  const warnings: string[] = [];
  const host = url.hostname;
  if (host === 'localhost' || host.endsWith('.local') || /^(127\.|10\.|192\.168\.)/.test(host)) warnings.push('This address is only reachable from this computer. Invitees will not be able to open it.');
  if (url.protocol === 'http:') warnings.push('This address is not secure (http). Use https so browsers do not warn visitors.');
  if (url.hash) warnings.push('The part after # is ignored by tracking and will be removed.');
  url.hash = '';
  return { ok: true, url: url.toString(), warnings };
}
