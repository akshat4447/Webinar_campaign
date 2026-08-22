import { pillColor } from './colors';

export function Badge({
  color,
  text,
  dot = false,
  size = 'sm',
}: {
  color?: string;
  text: string;
  dot?: boolean;
  size?: 'sm';
}) {
  const { bg, fg } = pillColor(color);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        height: size === 'sm' ? 22 : 26,
        padding: '0 10px',
        borderRadius: 'var(--radius-full)',
        background: bg,
        color: fg,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: fg,
            flexShrink: 0,
          }}
        />
      )}
      {text}
    </span>
  );
}
