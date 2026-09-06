'use client';

export function Checkbox({
  checked,
  onChange,
  size = 20,
  disabled = false,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
  disabled?: boolean;
}) {
  return (
    <span
      tabIndex={disabled ? -1 : 0}
      role="checkbox"
      aria-checked={checked}
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
        background: checked ? 'var(--accent-500)' : '#fff',
        boxShadow: checked ? 'none' : 'inset 0 0 0 1px var(--border-default)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        flexShrink: 0,
        outline: 'none',
      }}
    >
      {checked && (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12l5 5 11-11" />
        </svg>
      )}
    </span>
  );
}
