// Unit tests never inherit the developer's database. Integration tests require a named disposable DB.
const url = process.env.TEST_DATABASE_URL;
if (url && !/^webinar_(test|fix|audit)_[a-z0-9_]+$/i.test(new URL(url).pathname.slice(1))) throw new Error('TEST_DATABASE_URL must identify a disposable webinar_test_*, webinar_fix_*, or webinar_audit_* database.');
process.env.DATABASE_URL = url || 'postgresql://invalid:invalid@127.0.0.1:1/webinar_test_disabled';
process.env.REGISTRATION_SECRET = 'test-only-registration-signing-key-with-32-plus-characters';
process.env.CREDENTIALS_ENCRYPTION_KEY = 'test-only-credential-encryption-key-with-32-plus-characters';
process.env.CADENCE_AUTOTICK = 'false';
process.env.ZOOM_AUTOSYNC = 'false';
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Tests must mock external provider requests.');
  return realFetch(input, init);
};
