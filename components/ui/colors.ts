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
  // Aliases used across the app: they used to fall through to gray, so a "green" badge never looked green.
  orange: { bg: 'var(--component-colors-utility-orange-utility-orange-50, var(--warning-100))', fg: 'var(--component-colors-utility-orange-utility-orange-700, var(--warning-700))' },
  indigo: { bg: 'var(--component-colors-utility-indigo-utility-indigo-50, var(--accent-50))', fg: 'var(--component-colors-utility-indigo-utility-indigo-700, var(--accent-700))' },
  pink: { bg: 'var(--component-colors-utility-pink-utility-pink-50, var(--danger-100))', fg: 'var(--component-colors-utility-pink-utility-pink-700, var(--danger-700))' },
  green: { bg: 'var(--success-100)', fg: 'var(--success-700)' },
  danger: { bg: 'var(--danger-100)', fg: 'var(--danger-700)' },
  red: { bg: 'var(--danger-100)', fg: 'var(--danger-700)' },
  amber: { bg: 'var(--warning-100)', fg: 'var(--warning-700)' },
  purple: { bg: 'var(--component-colors-utility-purple-utility-purple-50, var(--accent-50))', fg: 'var(--component-colors-utility-purple-utility-purple-700, var(--accent-700))' },
  'purple light': { bg: 'var(--component-colors-utility-purple-utility-purple-50, var(--accent-50))', fg: 'var(--component-colors-utility-purple-utility-purple-700, var(--accent-700))' },
};

export function pillColor(name: string | undefined): ColorPair {
  return map[name ?? 'gray'] ?? map.gray;
}
