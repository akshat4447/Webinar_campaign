import { createHash, timingSafeEqual } from 'node:crypto';

export function cronAuthorization(request: Request, secret = process.env.CRON_SECRET): 'authorized' | 'unauthorized' | 'unconfigured' {
  if (!secret || secret.length < 32) return 'unconfigured';
  const authorization = request.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 4096) return 'unauthorized';
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(secret)) ? 'authorized' : 'unauthorized';
}
