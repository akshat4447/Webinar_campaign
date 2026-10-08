export class UnverifiedRecipientError extends Error {
  constructor(email: string) {
    super(`${email} was inferred by enrichment — verify it before sending.`);
    this.name = 'UnverifiedRecipientError';
  }
}

/** Every dispatch uses the requested recipient; inferred emails still require verification. */
export function resolveRecipient(contact: { email: string | null; emailSimulated?: boolean; emailVerified?: boolean }): { email: string } {
  if (contact.emailSimulated && !contact.emailVerified) throw new UnverifiedRecipientError(contact.email ?? 'This contact');
  if (!contact.email?.trim()) throw new Error('Contact has no email on file.');
  return { email: contact.email.trim().toLowerCase() };
}
