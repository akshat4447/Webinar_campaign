'use client';

// Styling lives in globals.css (.lsq-btn*) rather than inline, because hover,
// active, disabled and focus-visible states cannot be expressed as React inline
// styles — which is why this button previously declared a `transition` with
// nothing to transition. The public API is unchanged.

type Hierarchy = 'primary' | 'secondary' | 'secondary-color' | 'tertiary' | 'destructive-outline';
type Size = 'sm' | 'md';

export function Button({
  hierarchy = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  fullWidth = false,
  disabled = false,
  onClick,
  children,
  style,
  title,
  ariaLabel,
}: {
  hierarchy?: Hierarchy;
  size?: Size;
  icon?: React.ReactNode;
  iconPosition?: 'leading' | 'trailing';
  fullWidth?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`lsq-btn lsq-btn--${size} lsq-btn--${hierarchy}`}
      style={{ width: fullWidth ? '100%' : undefined, ...style }}
    >
      {icon && iconPosition === 'leading' ? icon : null}
      {children}
      {icon && iconPosition === 'trailing' ? icon : null}
    </button>
  );
}
