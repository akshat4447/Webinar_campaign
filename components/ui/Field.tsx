import { useId } from 'react';

/**
 * Label + control + hint + error, wired together for assistive tech.
 * `children` is a render function so the control receives the generated id and aria attributes:
 *
 *   <Field label="Webinar title" required error={err}>
 *     {(p) => <input className="lsq-input" {...p} value={v} onChange={...} />}
 *   </Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  optional?: boolean;
  children: (props: { id: string; 'aria-invalid'?: true; 'aria-describedby'?: string; 'aria-required'?: true }) => React.ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;
  const described = [hint ? hintId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className="lsq-field">
      <label className="lsq-label" htmlFor={id}>
        {label}
        {required && <span className="lsq-label__req" aria-hidden="true">*</span>}
        {optional && <span className="lsq-label__opt">(optional)</span>}
      </label>
      {children({ id, 'aria-invalid': error ? true : undefined, 'aria-describedby': described, 'aria-required': required ? true : undefined })}
      {hint && <p className="lsq-hint" id={hintId}>{hint}</p>}
      {error && <p className="lsq-error" id={errId} role="alert">{error}</p>}
    </div>
  );
}
