'use client';

export interface ToggleProps {
  on?: boolean;
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  size?: 'sm' | 'md';
}

export function Toggle({
  on,
  checked,
  onChange,
  disabled = false,
  ariaLabel = 'Toggle',
  size = 'md',
}: ToggleProps) {
  const isChecked = checked !== undefined ? checked : (on ?? false);

  const isSmall = size === 'sm';
  const width = isSmall ? 28 : 36;
  const height = isSmall ? 16 : 20;
  const thumbSize = isSmall ? 12 : 14;
  const thumbTop = isSmall ? 2 : 3;
  const thumbLeftOn = isSmall ? 14 : 19;
  const thumbLeftOff = isSmall ? 2 : 3;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isChecked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange?.(!isChecked);
      }}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          if (!disabled) onChange?.(!isChecked);
        }
      }}
      style={{
        position: 'relative',
        width,
        height,
        flexShrink: 0,
        borderRadius: 'var(--radius-full, 9999px)',
        background: isChecked ? 'var(--accent-500)' : 'var(--n40)',
        border: 'none',
        padding: 0,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        transition: 'background var(--dur-fast, 150ms) var(--ease-standard, ease)',
        outline: 'none',
        display: 'inline-flex',
        alignItems: 'center',
      }}
    >
      <span
        style={{
          position: 'absolute',
          width: thumbSize,
          height: thumbSize,
          top: thumbTop,
          left: isChecked ? thumbLeftOn : thumbLeftOff,
          background: 'var(--surface-card)',
          borderRadius: '50%',
          boxShadow: '0 1px 2px rgba(0, 0, 0, 0.2)',
          transition: 'left var(--dur-fast, 150ms) var(--ease-standard, ease)',
        }}
      />
    </button>
  );
}
