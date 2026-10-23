'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Icon } from '@/components/ui/Icon';
import { BrandMark } from '@/components/BrandMark';

// A plain form post to /api/auth/login, so signing in works before any script loads and a refresh never
// re-sends the password. The script only adds the busy state and the show/hide control.
export function LoginForm({ next, error, disabled }: { next: string; error: string | null; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const [show, setShow] = useState(false);

  return (
    <main className="lsq-login">
      <div className="lsq-login__col">
        <div className="lsq-login__brand">
          <BrandMark size={40} />
          <div>
            <h1 className="lsq-login__name">Webinar Studio</h1>
            <p className="lsq-login__tag">Campaign workspace</p>
          </div>
        </div>

        <form className="lsq-card lsq-login__card" method="post" action="/api/auth/login" onSubmit={() => setBusy(true)}>
          <div className="lsq-card__body lsq-stack">
            <div>
              <h2 className="lsq-card__title">Sign In</h2>
              <p className="lsq-card__sub">Enter the username and password for this workspace.</p>
            </div>

            {error && (
              <div className="lsq-banner lsq-banner--error" role="alert">
                <span className="lsq-banner__icon" aria-hidden="true"><Icon name="error" size={16} /></span>
                <p className="lsq-banner__body">{error}</p>
              </div>
            )}

            <input type="hidden" name="next" value={next} />
            <Field label="Username" required>
              {(p) => <input {...p} className="lsq-input" name="username" type="text" autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus required disabled={disabled} />}
            </Field>
            <Field label="Password" required>
              {(p) => (
                <div className="lsq-cluster lsq-wiz-inputrow">
                  <input {...p} className="lsq-input lsq-grow" name="password" type={show ? 'text' : 'password'} autoComplete="current-password" required disabled={disabled} />
                  <Button hierarchy="secondary" iconPosition="only" ariaLabel={show ? 'Hide password' : 'Show password'} icon={<Icon name="eye" size={16} />} onClick={() => setShow((v) => !v)} />
                </div>
              )}
            </Field>
            <Button type="submit" fullWidth loading={busy} disabled={disabled}>
              {busy ? 'Signing In' : 'Sign In'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
