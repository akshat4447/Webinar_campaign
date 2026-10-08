'use client';

// LeadSquared Button. Styling lives in globals.css (.lsq-btn*) because hover, active, disabled and
// focus-visible cannot be expressed as React inline styles. Hierarchies and sizes follow the design
// system's Button contract (primary / secondary / secondary-color / tertiary / destructive /
// destructive-outline / link; sm 32, md 40, lg 48). The original props are unchanged.

type Hierarchy = 'primary' | 'secondary' | 'secondary-color' | 'tertiary' | 'tertiary-color' | 'destructive' | 'destructive-outline' | 'link';
type Size = 'sm' | 'md' | 'lg';

export function Button({
  hierarchy = 'primary',
  size = 'md',
  icon,
  iconPosition = 'leading',
  fullWidth = false,
  disabled = false,
  loading = false,
  type = 'button',
  onClick,
  children,
  style,
  title,
  ariaLabel,
  className,
}: {
  hierarchy?: Hierarchy;
  size?: Size;
  icon?: React.ReactNode;
  /** `only` renders a square icon button — `ariaLabel` is then required for assistive tech. */
  iconPosition?: 'leading' | 'trailing' | 'only';
  fullWidth?: boolean;
  disabled?: boolean;
  /** Shows a spinner and blocks clicks; announced as busy. */
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  onClick?: () => void;
  children?: React.ReactNode;
  style?: React.CSSProperties;
  title?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const only = iconPosition === 'only';
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`lsq-btn lsq-btn--${size} lsq-btn--${hierarchy}${only ? ' lsq-btn--icon-only' : ''}${className ? ` ${className}` : ''}`}
      style={{ width: fullWidth ? '100%' : undefined, ...style }}
    >
      {loading ? <span className="lsq-spinner" aria-hidden="true" /> : icon && iconPosition !== 'trailing' ? icon : null}
      {only ? null : children}
      {icon && iconPosition === 'trailing' && !loading ? icon : null}
    </button>
  );
}
