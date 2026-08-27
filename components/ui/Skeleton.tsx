// Loading placeholders. The shimmer itself lives in globals.css (.lsq-skeleton)
// so it honours prefers-reduced-motion along with everything else.
//
// The point of these is to match the SHAPE of what's arriving. A generic spinner
// or three identical grey cards makes the page jump when real content lands;
// a skeleton that mirrors the final layout doesn't.

export function SkeletonLine({ width = '100%', height = 10, style }: { width?: string | number; height?: number; style?: React.CSSProperties }) {
  return <div className="lsq-skeleton" style={{ width, height, ...style }} />;
}

/** A card-shaped block with a title line and a few body lines. */
export function SkeletonCard({ lines = 2, height, style }: { lines?: number; height?: number; style?: React.CSSProperties }) {
  return (
    <div className="lsq-card" style={{ padding: '18px 20px', height, ...style }}>
      <SkeletonLine width="38%" height={13} style={{ marginBottom: 12 }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine key={i} width={i === lines - 1 ? '55%' : '80%'} />
        ))}
      </div>
    </div>
  );
}

/** Rows of a table, including the header strip. */
export function SkeletonTable({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="lsq-card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 16, padding: '14px 18px', borderBottom: '1px solid var(--border-default)' }}>
        {Array.from({ length: cols }).map((_, i) => (
          <SkeletonLine key={i} width={i === 0 ? 160 : 90} height={9} />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} style={{ display: 'flex', gap: 16, alignItems: 'center', padding: '13px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
          {Array.from({ length: cols }).map((_, i) => (
            <SkeletonLine key={i} width={i === 0 ? 160 : 90} height={11} />
          ))}
        </div>
      ))}
    </div>
  );
}
