import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

/** The security boundary for operator reads and mutations, independent of routing/proxy rules. */
export async function requireOperatorSession(): Promise<{ username: string }> {
  const session = await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) throw new Error('Sign in required');
  return session;
}
