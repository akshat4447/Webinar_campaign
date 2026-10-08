'use client';

import { useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';

interface Props {
  campaignId: string;
  channel: string;
  token: string | null;
  defaults: { firstName: string; lastName: string; email: string };
}

type Errors = Partial<Record<'firstName' | 'email' | 'form', string>>;

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

export function RegisterForm({ campaignId, channel, token, defaults }: Props) {
  const router = useRouter();
  const uid = useId();
  const [values, setValues] = useState({ ...defaults, company: '' });
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof typeof values, v: string) => {
    setValues((p) => ({ ...p, [k]: v }));
    // Clear a field's error as soon as the person starts correcting it (audit L-1: stale errors).
    setErrors((e) => (k === 'firstName' || k === 'email' ? { ...e, [k]: undefined, form: undefined } : { ...e, form: undefined }));
  };

  function validate(): Errors {
    const e: Errors = {};
    if (!values.firstName.trim()) e.firstName = 'Enter a first name.';
    if (!values.email.trim()) e.email = 'Enter an email address.';
    else if (!EMAIL_RE.test(values.email.trim())) e.email = 'Enter a valid email address, like name@company.com.';
    return e;
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (busy) return;
    const e = validate();
    setErrors(e);
    if (e.firstName) return void firstRef.current?.focus();
    if (e.email) return void emailRef.current?.focus();

    setBusy(true);
    try {
      const res = await fetch('/api/landing/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaignId,
          token: token ?? undefined,
          email: values.email.trim(),
          firstName: values.firstName.trim(),
          lastName: values.lastName.trim(),
          company: values.company.trim(),
          source: channel,
          website: honeypot.current?.value ?? '',
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; token?: string; alreadyRegistered?: boolean; reason?: string };
      if (res.ok && data.ok) {
        router.push(`/r/result?status=${data.alreadyRegistered ? 'already' : 'registered'}${data.token ? `&t=${encodeURIComponent(data.token)}` : ''}`);
        return;
      }
      if (data.ok) { setSubmitted(true); return; }
      if (res.status === 429) setErrors({ form: 'Too many attempts. Wait a minute and try again.' });
      else if (res.status === 409) router.refresh();
      else if (res.status === 400 && data.error && /email/i.test(data.error)) setErrors({ email: data.error });
      else setErrors({ form: 'Registration did not go through. Check the details and try again.' });
    } catch {
      setErrors({ form: 'The connection dropped. Check the network and try again.' });
    } finally {
      setBusy(false);
    }
  }

  if (submitted) return <p role="status">Registration saved. Your organizer will provide joining details by email.</p>;
  const id = (n: string) => `${uid}-${n}`;
  return (
    <form onSubmit={submit} noValidate className="lsq-stack">
      <div className="lsq-grid lsq-grid--narrow">
        <div className="lsq-field">
          <label className="lsq-label" htmlFor={id('fn')}>First name<span className="lsq-label__req" aria-hidden="true">*</span></label>
          <input
            ref={firstRef} id={id('fn')} className="lsq-input" autoComplete="given-name" required aria-required="true"
            aria-invalid={errors.firstName ? true : undefined} aria-describedby={errors.firstName ? id('fn-err') : undefined}
            value={values.firstName} onChange={(e) => set('firstName', e.target.value)} maxLength={100}
          />
          {errors.firstName ? <p id={id('fn-err')} className="lsq-error" role="alert">{errors.firstName}</p> : null}
        </div>
        <div className="lsq-field">
          <label className="lsq-label" htmlFor={id('ln')}>Last name<span className="lsq-label__opt">(optional)</span></label>
          <input id={id('ln')} className="lsq-input" autoComplete="family-name" value={values.lastName} onChange={(e) => set('lastName', e.target.value)} maxLength={100} />
        </div>
      </div>

      <div className="lsq-field">
        <label className="lsq-label" htmlFor={id('em')}>Work email<span className="lsq-label__req" aria-hidden="true">*</span></label>
        <input
          ref={emailRef} id={id('em')} type="email" inputMode="email" className="lsq-input" autoComplete="email" required aria-required="true"
          aria-invalid={errors.email ? true : undefined} aria-describedby={errors.email ? id('em-err') : undefined}
          value={values.email} onChange={(e) => set('email', e.target.value)} maxLength={254}
        />
        {errors.email ? <p id={id('em-err')} className="lsq-error" role="alert">{errors.email}</p> : null}
      </div>

      <div className="lsq-field">
        <label className="lsq-label" htmlFor={id('co')}>Company<span className="lsq-label__opt">(optional)</span></label>
        <input id={id('co')} className="lsq-input" autoComplete="organization" value={values.company} onChange={(e) => set('company', e.target.value)} maxLength={200} />
      </div>

      {/* Honeypot: invisible to people and assistive tech, tempting to bots. */}
      <div aria-hidden="true" className="lsq-sr-only">
        <label htmlFor={id('hp')}>Website</label>
        <input ref={honeypot} id={id('hp')} name="website" tabIndex={-1} autoComplete="off" />
      </div>

      <div aria-live="polite">{errors.form ? <p className="lsq-error" role="alert">{errors.form}</p> : null}</div>

      <Button type="submit" size="lg" fullWidth loading={busy}>{busy ? 'Registering…' : 'Register'}</Button>
    </form>
  );
}
