'use client';

type Hierarchy = 'primary' | 'secondary' | 'secondary-color' | 'tertiary' | 'destructive-outline';
type Size = 'sm' | 'md';

const base: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontWeight: 600,
  border: 'none',
  borderRadius: 'var(--radius-md)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '6px',
  transition: 'background 0.12s ease, box-shadow 0.12s ease',
  whiteSpace: 'nowrap',
};

function hierarchyStyle(hierarchy: Hierarchy, disabled?: boolean): React.CSSProperties {
  if (disabled) {
    return { background: 'var(--n20)', color: 'var(--n50)', boxShadow: 'none' };
  }
  switch (hierarchy) {
    case 'primary':
      return { background: 'var(--accent-500)', color: '#fff' };
    case 'secondary':
      return { background: '#fff', color: 'var(--n80)', boxShadow: 'inset 0 0 0 1px var(--border-default)' };
    case 'secondary-color':
      return { background: '#fff', color: 'var(--accent-500)', boxShadow: 'inset 0 0 0 1px var(--accent-500)' };
    case 'tertiary':
      return { background: 'transparent', color: 'var(--n70)' };
    case 'destructive-outline':
      return { background: '#fff', color: 'var(--danger-500)', boxShadow: 'inset 0 0 0 1px var(--danger-500)' };
  }
}

const sizeStyle: Record<Size, React.CSSProperties> = {
  sm: { height: 32, padding: '0 12px', fontSize: 12.5 },
  md: { height: 40, padding: '0 16px', fontSize: 13.5 },
};

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
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        ...base,
        ...sizeStyle[size],
        ...hierarchyStyle(hierarchy, disabled),
        width: fullWidth ? '100%' : undefined,
        ...style,
      }}
    >
      {icon && iconPosition === 'leading' ? icon : null}
      {children}
      {icon && iconPosition === 'trailing' ? icon : null}
    </button>
  );
}
