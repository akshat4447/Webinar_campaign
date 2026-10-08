// Small hand-authored outline glyph set — currentColor stroke, matching the LeadSquared
// design system's icon style (single-color outline glyphs). Only the names the app
// actually uses are implemented; add more here as needed.

type IconName =
  | 'document'
  | 'arrow-right'
  | 'close'
  | 'upload'
  | 'info'
  | 'error'
  | 'plus'
  | 'chat'
  | 'more'
  | 'eye'
  | 'eye-off'
  | 'chevron-down'
  | 'trash'
  | 'dashboard'
  | 'template'
  | 'copy'
  | 'x'
  | 'search'
  | 'filter'
  | 'grid'
  | 'list'
  | 'linkedin'
  | 'share'
  | 'check'
  | 'edit'
  | 'external'
  | 'clock'
  | 'send'
  | 'warning'
  | 'mail'
  | 'sms'
  | 'calendar'
  | 'chevron-right'
  | 'chevron-up'
  | 'lock'
  | 'skip'
  | 'refresh'
  | 'phone'
  | 'undo'
  | 'play'
  | 'pause'
  | 'stop'
  | 'user'
  | 'whatsapp'
  | 'bolt'
  | 'settings'
  | 'globe'
  | 'home'
  | 'download'
  | 'bell'
  | 'sort'
  | 'key'
  | 'database'
  | 'users'
  | 'tag'
  | 'link'
  | 'image'
  | 'trending'
  | 'bar-chart'
  | 'shield'
  | 'file-text'
  | 'minus'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'chevron-left'
  | 'help'
  | 'sparkle'
  | 'plug'
  | 'check-circle'
  | 'x-circle'
  | 'rows'
  | 'sliders'
  | 'video'
  | 'zap';

const paths: Record<IconName, React.ReactNode> = {
  document: (
    <>
      <path d="M6 2.5h7l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M13 2.5V7a1 1 0 0 0 1 1h4" />
    </>
  ),
  'arrow-right': (
    <>
      <path d="M4 12h16" />
      <path d="M13 5l7 7-7 7" />
    </>
  ),
  close: (
    <>
      <path d="M5 5l14 14" />
      <path d="M19 5L5 19" />
    </>
  ),
  upload: (
    <>
      <path d="M12 20V8" />
      <path d="M6 13l6-6 6 6" />
      <path d="M4 20h16" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <circle cx="12" cy="7.75" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.25" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  chat: (
    <path d="M4 4.5h16v12H12.5L8 20v-3.5H4v-12Z" />
  ),
  more: (
    <>
      <circle cx="12" cy="5.5" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <path d="M2 2l20 20" />
    </>
  ),
  'chevron-down': (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  // Four unequal panes — reads as an overview of several things at once,
  // which is what the cross-campaign dashboard is.
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </>
  ),
  // A header band over a body and a sidebar — a page skeleton rather than a
  // document, to distinguish templates from the 'document' glyph.
  template: (
    <>
      <path d="M4 4h16v4H4z" />
      <path d="M4 12h10v8H4z" />
      <path d="M18 12h2v8h-2z" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </>
  ),
  x: (
    <>
      <path d="M18 6L6 18M6 6l12 12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </>
  ),
  filter: (
    <>
      <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" strokeWidth={2.4} />
      <line x1="3" y1="12" x2="3.01" y2="12" strokeWidth={2.4} />
      <line x1="3" y1="18" x2="3.01" y2="18" strokeWidth={2.4} />
    </>
  ),
  linkedin: (
    <>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect x="2" y="9" width="4" height="12" />
      <circle cx="4" cy="4" r="2" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
      <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
    </>
  ),
  'check': (
    <>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </>
  ),
  'edit': (
    <>
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" /><path d="M14 8l3 3" />
    </>
  ),
  'external': (
    <>
      <path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  'clock': (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </>
  ),
  'send': (
    <>
      <path d="M21 3L10 14" /><path d="M21 3l-7 18-4-7-7-4 18-7Z" />
    </>
  ),
  'warning': (
    <>
      <path d="M12 3.5l9.5 16.5h-19L12 3.5Z" /><path d="M12 10v4.5" /><circle cx="12" cy="17.25" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'mail': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" />
    </>
  ),
  'sms': (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-8l-5 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" /><path d="M8 10.5h8" /><path d="M8 13.5h5" />
    </>
  ),
  'calendar': (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17" /><path d="M8 3v4" /><path d="M16 3v4" />
    </>
  ),
  'chevron-right': (
    <>
      <path d="M9 5l7 7-7 7" />
    </>
  ),
  'chevron-up': (
    <>
      <path d="M5 15l7-7 7 7" />
    </>
  ),
  'lock': (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  'skip': (
    <>
      <path d="M5 5l9 7-9 7V5Z" /><path d="M19 5v14" />
    </>
  ),
  'refresh': (
    <>
      <path d="M20 11a8 8 0 0 0-14.5-4" /><path d="M5 3v4h4" /><path d="M4 13a8 8 0 0 0 14.5 4" /><path d="M19 21v-4h-4" />
    </>
  ),
  'phone': (
    <>
      <path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z" />
    </>
  ),
  'undo': (
    <>
      <path d="M9 8L4 13l5 5" /><path d="M4 13h10a6 6 0 0 1 6 6" />
    </>
  ),
  'play': (
    <>
      <path d="M7 4.5l12 7.5-12 7.5v-15Z" />
    </>
  ),
  'pause': (
    <>
      <path d="M8 5v14" /><path d="M16 5v14" />
    </>
  ),
  'stop': (
    <>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
    </>
  ),
  'user': (
    <>
      <circle cx="12" cy="8" r="4" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  'whatsapp': (
    <>
      <path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8L4 20Z" /><path d="M9 9.5c.3 2 2.5 4.2 4.5 4.5l1.3-1.2-2-1-.8.7a3.5 3.5 0 0 1-1.7-1.7l.7-.8-1-2L9 9.5Z" />
    </>
  ),
  'bolt': (
    <>
      <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3Z" />
    </>
  ),
  'settings': (
    <>
      <circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5h0a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
    </>
  ),
  'globe': (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18" /><path d="M12 3a14 14 0 0 0 0 18" />
    </>
  ),
  'home': (
    <>
      <path d="M4 11l8-7 8 7" /><path d="M6 10v10h12V10" /><path d="M10 20v-5h4v5" />
    </>
  ),
  'download': (
    <>
      <path d="M12 4v12" /><path d="M6 11l6 6 6-6" /><path d="M4 20h16" />
    </>
  ),
  'bell': (
    <>
      <path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15L6 17Z" /><path d="M10 21a2 2 0 0 0 4 0" />
    </>
  ),
  'sort': (
    <>
      <path d="M8 4v16" /><path d="M4 8l4-4 4 4" /><path d="M16 20V4" /><path d="M12 16l4 4 4-4" />
    </>
  ),
  'key': (
    <>
      <circle cx="8" cy="15" r="4" /><path d="M11 12l9-9" /><path d="M16 7l3 3" />
    </>
  ),
  'database': (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" /><path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  'users': (
    <>
      <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7" /><path d="M18 14a6.5 6.5 0 0 1 3.5 6" />
    </>
  ),
  'tag': (
    <>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" /><circle cx="7.5" cy="8.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  'link': (
    <>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </>
  ),
  'image': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="1.8" /><path d="M21 16l-5-5-8 8" />
    </>
  ),
  'trending': (
    <>
      <path d="M3 17l6-6 4 4 8-9" /><path d="M15 6h6v6" />
    </>
  ),
  'bar-chart': (
    <>
      <path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />
    </>
  ),
  'shield': (
    <>
      <path d="M12 3l8 3v6c0 4.5-3.2 8-8 9-4.8-1-8-4.5-8-9V6l8-3Z" /><path d="M9 12l2 2 4-4" />
    </>
  ),
  'file-text': (
    <>
      <path d="M6 2.5h7l4 4V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" /><path d="M8.5 12h7" /><path d="M8.5 16h7" /><path d="M8.5 8h2.5" />
    </>
  ),
  'minus': (
    <>
      <path d="M5 12h14" />
    </>
  ),
  'arrow-left': (
    <>
      <path d="M20 12H4" /><path d="M11 5l-7 7 7 7" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 20V4" /><path d="M5 11l7-7 7 7" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4v16" /><path d="M5 13l7 7 7-7" />
    </>
  ),
  'chevron-left': (
    <>
      <path d="M15 5l-7 7 7 7" />
    </>
  ),
  'help': (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.6 2.6 0 0 1 5 1c0 1.7-2.5 2-2.5 3.5" /><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  'sparkle': (
    <>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z" /><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7.7-2Z" />
    </>
  ),
  'plug': (
    <>
      <path d="M9 3v5" /><path d="M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0V8Z" /><path d="M12 17v4" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" />
    </>
  ),
  'x-circle': (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M9 9l6 6" /><path d="M15 9l-6 6" />
    </>
  ),
  'rows': (
    <>
      <rect x="3" y="4" width="18" height="6" rx="1.5" /><rect x="3" y="14" width="18" height="6" rx="1.5" />
    </>
  ),
  'sliders': (
    <>
      <path d="M4 7h10" /><path d="M18 7h2" /><circle cx="16" cy="7" r="2" /><path d="M4 17h2" /><path d="M10 17h10" /><circle cx="8" cy="17" r="2" />
    </>
  ),
  'video': (
    <>
      <rect x="3" y="6" width="13" height="12" rx="2" /><path d="M16 10.5l5-3v9l-5-3" />
    </>
  ),
  'zap': (
    <>
      <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3Z" />
    </>
  ),
};

const nameAliases: Record<string, IconName> = {
  AnyDocumentProperty1Outline: 'document',
  ArrowRight: 'arrow-right',
  CloseProperty1Outline: 'close',
  DownloadProperty1Outline: 'upload',
  InformationProperty1Outline: 'info',
  ErrorProperty1Outline: 'error',
  AddProperty1Outline: 'plus',
  ConverseProperty1Outline: 'chat',
};

export function Icon({
  name,
  size = 16,
  style,
}: {
  name: string;
  size?: number;
  style?: React.CSSProperties;
}) {
  const resolved = nameAliases[name] ?? (name as IconName);
  const body = paths[resolved];
  if (!body) return null;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
    >
      {body}
    </svg>
  );
}
