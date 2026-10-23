import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SESSION_COOKIE, authConfig, safeNextPath, verifySessionToken } from '@/lib/auth';
import { LoginForm } from './LoginForm';

export const metadata: Metadata = { title: 'Sign In | Webinar Studio' };
export const dynamic = 'force-dynamic';

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const MESSAGES: Record<string, string> = {
  invalid: 'The username or password is not correct.',
  rate: 'Too many attempts. Wait a few minutes and try again.',
  unconfigured: 'Sign-in is not set up on this server. Set APP_USERNAME and APP_PASSWORD, then restart.',
};

export default async function LoginPage(props: PageProps<'/login'>) {
  const sp = await props.searchParams;
  const next = safeNextPath(first(sp.next));
  const errorKey = first(sp.error);

  // Someone who is already signed in has no use for this page.
  if (await verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);

  const configured = authConfig().configured;
  const error = !configured ? MESSAGES.unconfigured : errorKey ? (MESSAGES[errorKey] ?? MESSAGES.invalid) : null;
  return <LoginForm next={next} error={error} disabled={!configured} />;
}
