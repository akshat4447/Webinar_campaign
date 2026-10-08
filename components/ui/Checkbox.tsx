'use client';

export function Checkbox({
  checked,
  onChange,
  size = 20,
  disabled = false,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
  disabled?: boolean;
  /** Required in practice for standalone checkboxes (e.g. a row-approval box in
   *  a table): without it the control is a `role="checkbox"` span with no text
   *  inside, so a screen reader announces an unnamed checkbox and the operator
   *  has no way to tell which row it belongs to. */
  'aria-label'?: string;
}) {
  return (
    <span
      tabIndex={disabled ? -1 : 0}
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onChange?.(!checked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onChange?.(!checked);
        }
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--radius-xs)',
        background: checked ? 'var(--accent-500)' : 'var(--surface-card)',
        boxShadow: checked ? 'none' : 'inset 0 0 0 1px var(--border-default)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
        outline: 'none',
      }}
    >
      {checked && (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="var(--text-inverse)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12l5 5 11-11" />
        </svg>
      )}
    </span>
  );
}
