import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

// Source-level guards for accessibility defects this audit fixed. There is no DOM
// test environment in this repo, so these scan the TSX instead — cheap, and they fail
// loudly with the exact file:line the moment someone reintroduces the pattern.

const ROOT = join(__dirname, '..');

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith('.tsx') && !p.endsWith('.test.tsx')) out.push(p);
  }
  return out;
}

const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'components'))];
const lineOf = (src: string, idx: number) => src.slice(0, idx).split('\n').length;
const where = (f: string, src: string, idx: number) => `${relative(ROOT, f)}:${lineOf(src, idx)}`;

describe('accessibility regression guards', () => {
  it('every symbol-only button (×, ✕…) has an accessible name', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/>\s*(×|✕|✖|&times;)\s*<\/button>/g)) {
        const start = src.lastIndexOf('<button', m.index);
        if (!src.slice(start, m.index! + 1).includes('aria-label')) bad.push(where(f, src, start));
      }
    }
    expect(bad).toEqual([]);
  });

  it('no <img> without alt text', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(/<img\b[^>]*>/g)) if (!/\balt=/.test(m[0])) bad.push(where(f, src, m.index!));
    }
    expect(bad).toEqual([]);
  });

  it('tab/toggle controls are real buttons, not clickable divs', () => {
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      // A div that handles clicks but is neither a backdrop (inset: 0), nor a stopPropagation shield,
      // nor given a role/keyboard handler, cannot be reached from the keyboard.
      for (const m of src.matchAll(/<div\b[^\n]*onClick=[^\n]*/g)) {
        const tag = m[0]; // the whole line: a tag's own `=>` would otherwise end a naive `[^>]*` match early
        if (/inset: 0/.test(tag) || /stopPropagation/.test(tag) || /role=|onKeyDown|tabIndex/.test(tag)) continue;
        bad.push(where(f, src, m.index!));
      }
    }
    expect(bad).toEqual([]);
  });

  it('modal panels announce themselves as dialogs', () => {
    // Dialogs are built on components/ui/Modal, which sets role="dialog" and aria-modal itself;
    // a file that still hand-rolls one must declare both.
    const dialogFiles = [
      'components/cadence/BroadcastReminderModal.tsx',
      'components/cadence/LinkedInFastRunnerModal.tsx',
      'app/(studio)/campaigns/[id]/agent/ControlPanel.tsx',
    ];
    for (const rel of dialogFiles) {
      const src = readFileSync(join(ROOT, rel), 'utf8');
      const onSharedModal = /from '@\/components\/ui\/Modal'/.test(src);
      const handRolled = /role="dialog"[\s\S]{0,40}aria-modal="true"/.test(src);
      expect(onSharedModal || handRolled, rel).toBe(true);
    }
  });

  it('root error, global-error and loading boundaries exist', () => {
    for (const rel of ['app/(studio)/error.tsx', 'app/global-error.tsx', 'app/(studio)/loading.tsx']) expect(existsSync(join(ROOT, rel)), rel).toBe(true);
  });
});
