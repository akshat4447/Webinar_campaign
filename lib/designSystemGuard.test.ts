import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Regression guard for the LeadSquared design-system rules the redesign established (docs/UI_KIT.md).
// It scans source, so a future change that reintroduces emoji icons, gradients, blur, raw colours or a
// pile of inline styles fails here instead of being found in an audit.

const ROOT = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.') || name === 'generated') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}
const files = [...walk(join(ROOT, 'app')), ...walk(join(ROOT, 'components'))];
const rel = (f: string) => relative(ROOT, f);
const read = (f: string) => readFileSync(f, 'utf8');

// Brand artwork is the one place raw colours are allowed: the LeadSquared logo SVGs.
const HEX_ALLOWED = new Set(['components/Sidebar.tsx']);

describe('design-system guard', () => {
  it('uses no emoji or glyph icons in UI code (use <Icon />)', () => {
    const bad: string[] = [];
    for (const f of files) {
      read(f).split('\n').forEach((line, i) => {
        if (/\p{Extended_Pictographic}/u.test(line.replace(/[©®™]/g, '')) || /[←-⇿✓✕✦×]/.test(line.replace(/\/\/.*$/, '').replace(/&times;/g, ''))) {
          // Allow glyphs only inside comments.
          if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
          bad.push(`${rel(f)}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });

  it('has no gradients or blur', () => {
    const bad = files.filter((f) => /gradient\(|backdropFilter|backdrop-filter/.test(read(f))).map(rel);
    expect(bad).toEqual([]);
  });

  it('has no raw hex colours outside the brand logo', () => {
    const bad: string[] = [];
    for (const f of files) {
      if (HEX_ALLOWED.has(rel(f))) continue;
      read(f).split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/(['"`(\s])#[0-9a-fA-F]{3,8}\b/.test(line) && /(color|background|border|fill|stroke|boxShadow|shadow)/i.test(line)) bad.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(bad).toEqual([]);
  });

  it('keeps inline styles to dynamic values only (ratchet)', () => {
    const counts = files.map((f) => ({ f: rel(f), n: (read(f).match(/style=\{\{/g) ?? []).length })).filter((x) => x.n > 0);
    const total = counts.reduce((a, b) => a + b.n, 0);
    const worst = counts.sort((a, b) => b.n - a.n)[0];
    // Was ~3,000 before the redesign. Only computed widths/positions and the scroll-container <main> remain.
    expect(total, `total inline styles (worst: ${worst?.f} ${worst?.n})`).toBeLessThanOrEqual(110);
    expect(worst?.n ?? 0, `most inline styles in one file: ${worst?.f}`).toBeLessThanOrEqual(14);
  });

  it('has no gradient shimmer in global CSS', () => {
    expect(read(join(ROOT, 'app/globals.css'))).not.toMatch(/gradient\(/);
    expect(read(join(ROOT, 'styles/components.css'))).not.toMatch(/gradient\(/);
  });
});
