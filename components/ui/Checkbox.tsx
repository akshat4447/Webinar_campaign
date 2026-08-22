'use client';

export function Checkbox({
  checked,
  onChange,
  size = 20,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  size?: number;
}) {
  return (
    <span
      onClick={() => onChange?.(!checked)}
      role="checkbox"
      aria-checked={checked}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: 'var(--radius-xs)',
        background: checked ? 'var(--accent-500)' : '#fff',
        boxShadow: checked ? 'none' : 'inset 0 0 0 1px var(--border-default)',
        cursor: 'pointer',
        flexShrink: 0,
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
