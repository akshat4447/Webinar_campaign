// The title block every top-level page opens with. Extracted because the new
// IA has five of them and they must agree on type scale and spacing — the
// previous shell repeated these values inline on each page and they had already
// drifted apart by a pixel or two.

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  /** Right-aligned controls. Wraps below the title on narrow viewports. */
  actions?: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        marginBottom: 24,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 'var(--fs-heading-2)',
            fontWeight: 'var(--fw-bold)',
            color: 'var(--n90)',
            letterSpacing: '-0.01em',
            lineHeight: 1.2,
          }}
        >
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', marginTop: 3 }}>{subtitle}</div>
        )}
      </div>
      {actions}
    </div>
  );
}
