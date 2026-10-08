import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
const PREFIX = 'enc:v1:';
function key() {
  const secret = process.env.CREDENTIALS_ENCRYPTION_KEY || process.env.REGISTRATION_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set CREDENTIALS_ENCRYPTION_KEY to at least 32 random characters before saving credentials.');
  return createHash('sha256').update(`webinar-credentials-v1:${secret}`).digest();
}
export function encryptCredential(value: string): string {
  if (!value || value.startsWith(PREFIX)) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}
export function decryptCredential(value: string): string {
  if (!value.startsWith(PREFIX)) return value; // Existing installations can migrate without losing credentials.
  const raw = Buffer.from(value.slice(PREFIX.length), 'base64');
  if (raw.length < 28) throw new Error('Invalid encrypted credential.');
  const cipher = createDecipheriv('aes-256-gcm', key(), raw.subarray(0, 12));
  cipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([cipher.update(raw.subarray(28)), cipher.final()]).toString('utf8');
}
