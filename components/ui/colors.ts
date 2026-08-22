// Maps the design system's named badge/tag colors (as used throughout the original
// mock: "success" | "warning" | "error" | "gray" | "blue" | "blue light" | "gray blue")
// onto the real token values in styles/tokens/colors.css.

export interface ColorPair {
  bg: string;
  fg: string;
}

const map: Record<string, ColorPair> = {
  success: { bg: 'var(--success-100)', fg: 'var(--success-700)' },
  warning: { bg: 'var(--warning-100)', fg: 'var(--warning-700)' },
  error: { bg: 'var(--danger-100)', fg: 'var(--danger-700)' },
  gray: { bg: 'var(--n20)', fg: 'var(--n60)' },
  'gray blue': { bg: 'var(--n20)', fg: 'var(--n70)' },
  blue: { bg: 'var(--info-100)', fg: 'var(--accent-700)' },
  'blue light': { bg: 'var(--accent-50)', fg: 'var(--accent-700)' },
};

export function pillColor(name: string | undefined): ColorPair {
  return map[name ?? 'gray'] ?? map.gray;
}
