// Pure. The embed script posts registrations from visitors' browsers to Studio's address, so that address has to be
// one a browser on the public internet can reach, over https. Says why it is not, or null when it is fine.

const PRIVATE_HOST = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0$|\[?::1\]?$)|\.local$/;

export function scriptOriginProblem(origin: string | null | undefined): string | null {
  if (!origin) return null;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return "Studio's address is not a valid web address.";
  }
  if (PRIVATE_HOST.test(url.hostname) || /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname)) {
    return `The script sends registrations to ${url.origin}, which visitors' browsers cannot reach. Deploy Studio and set its public address first, then copy the script again.`;
  }
  if (url.protocol !== 'https:') {
    return `The script sends registrations to ${url.origin}, which is not https. A published https page cannot send to it. Serve Studio over https, then copy the script again.`;
  }
  return null;
}
