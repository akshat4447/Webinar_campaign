// Mail sent as events@digital.leadsquared.com to someone at leadsquared.com is mail a company sends to itself. The
// recipient's own mail system can hold or flag it (for example with an "unauthenticated source" banner) even though the
// sending service accepted it, so the app says so before launch.

// Second-level public suffixes that make the "company" part three labels long (example.co.uk, not co.uk).
const TWO_PART_SUFFIXES = new Set(['co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'org.au', 'co.in', 'net.in', 'org.in', 'co.nz', 'co.za', 'co.jp', 'com.br', 'com.sg', 'com.mx', 'com.tr', 'com.cn']);

/** The company part of a mail domain: "digital.leadsquared.com" gives "leadsquared.com". Empty when there is none. */
export function organizationDomain(domain: string | null | undefined): string {
  const labels = (domain ?? '').trim().toLowerCase().replace(/^@/, '').replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length < 2) return '';
  const keep = TWO_PART_SUFFIXES.has(labels.slice(-2).join('.')) ? 3 : 2;
  return labels.slice(-keep).join('.');
}

export function emailDomainOf(email: string | null | undefined): string {
  const at = (email ?? '').lastIndexOf('@');
  return at < 0 ? '' : (email as string).slice(at + 1).trim().toLowerCase();
}

/** True when the recipient's address belongs to the same company as the sender's domain. */
export function sharesOrganization(senderEmail: string | null | undefined, recipientEmail: string | null | undefined): boolean {
  const sender = organizationDomain(emailDomainOf(senderEmail));
  return Boolean(sender) && organizationDomain(emailDomainOf(recipientEmail)) === sender;
}
