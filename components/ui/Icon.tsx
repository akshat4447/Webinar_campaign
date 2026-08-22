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
  | 'chat';

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
