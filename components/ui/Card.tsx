// Surface styling comes from .lsq-card in globals.css so every card shares one
// definition. The lift-on-hover variant is applied only when the card is
// actually clickable — a static panel that reacts to the cursor is misleading.

export function Card({
  children,
  pad = true,
  style,
  onClick,
}: {
  children: React.ReactNode;
  pad?: boolean;
  style?: React.CSSProperties;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={onClick ? 'lsq-card lsq-card--interactive' : 'lsq-card'}
      style={{ padding: pad ? '18px 20px' : 0, ...style }}
    >
      {children}
    </div>
  );
}
