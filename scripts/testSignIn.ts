import { expect, type BrowserContext } from '@playwright/test';

// The browser-test servers run with the sign-in on, like production. These are test-only values for the
// disposable servers those scripts start; they are not the operator's credentials.
export const TEST_LOGIN_ENV = { APP_USERNAME: 'tester', APP_PASSWORD: 'test-only-password-for-disposable-servers' } as const;

/** Signs the browser context in. The session cookie lands in the context, so every page and request in it has it. */
export async function signIn(context: BrowserContext, origin: string): Promise<void> {
  const res = await context.request.post(`${origin}/api/auth/login`, {
    form: { username: TEST_LOGIN_ENV.APP_USERNAME, password: TEST_LOGIN_ENV.APP_PASSWORD },
    maxRedirects: 0,
  });
  expect(res.status(), 'sign-in should answer with a redirect').toBe(303);
  expect(res.headers()['set-cookie'] ?? '').toContain('webinar_session=');
}
