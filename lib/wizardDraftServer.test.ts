import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// An autosave fires on every pause in typing, so it must never be able to reach anything with a side effect
// outside our own database: no Zoom, no CRM, no email gateway, no enrichment, no AI, no sender. The runtime
// check lives in test-support/integration/wizardDraft.integration.test.ts (zero outbound requests); this one
// fails the moment someone imports such a module into the draft save path, before it can ever run.

const ROOT = path.resolve(__dirname, '..');
const ENTRY_POINTS = ['lib/wizardDraftServer.ts', 'lib/wizardMessagingPersist.ts', 'lib/actions/wizardDraft.ts', 'app/api/wizard/draft/route.ts'];

const FORBIDDEN = [
  /zoom/i, /lsq|leadsquared/i, /netcore/i, /apollo/i, /anthropic|claude|personalization|enrich/i, /channelDelivery|sendGuard|broadcast/i,
  /linkedin/i, /\/cadence(\.|\/)/i, /registerContact|registration(Reconcile|Sync)/i, /nodemailer|twilio|axios/i,
];

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null; // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (existsSync(candidate) && /\.tsx?$/.test(candidate)) return candidate;
  return null;
}

function importsOf(file: string): { local: string[]; packages: string[] } {
  const src = readFileSync(file, 'utf8');
  const specs = [...src.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/g)].map((m) => m[1])
    .concat([...src.matchAll(/(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)].map((m) => m[1])) // bare: import 'x'
    .concat([...src.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1])) // dynamic
    .concat([...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]));
  const local: string[] = [];
  const packages: string[] = [];
  for (const spec of specs) {
    const r = resolveImport(file, spec);
    if (r) local.push(r);
    else if (!spec.startsWith('.') && !spec.startsWith('@/')) packages.push(spec);
  }
  return { local, packages };
}

function closure(entries: string[]): { files: Set<string>; packages: Set<string> } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const stack = entries.map((e) => path.join(ROOT, e));
  while (stack.length) {
    const f = stack.pop()!;
    // The generated database client describes every table, including ones named after providers; it makes no calls.
    if (files.has(f) || f.includes(`${path.sep}lib${path.sep}generated${path.sep}`)) continue;
    files.add(f);
    const { local, packages: pk } = importsOf(f);
    pk.forEach((p) => packages.add(p));
    stack.push(...local);
  }
  return { files, packages };
}

describe('the draft save path is side-effect free', () => {
  const { files, packages } = closure(ENTRY_POINTS);
  const rel = [...files].map((f) => path.relative(ROOT, f));

  it('walks a real import graph (so this guard cannot pass by finding nothing)', () => {
    expect(rel).toContain('lib/db.ts');
    expect(rel).toContain('lib/wizardDraft.ts');
    expect(rel).toContain('lib/campaignDefaults.ts');
    expect(rel.length).toBeGreaterThan(8);
  });

  it('imports no provider, sender, enrichment or AI module, directly or transitively', () => {
    const offenders = rel.filter((f) => FORBIDDEN.some((re) => re.test(f)));
    expect(offenders).toEqual([]);
  });

  it('imports no outbound-capable package', () => {
    const offenders = [...packages].filter((p) => FORBIDDEN.some((re) => re.test(p)));
    expect(offenders).toEqual([]);
  });

  it('never calls fetch itself', () => {
    const offenders = rel.filter((f) => /\bfetch\(/.test(readFileSync(path.join(ROOT, f), 'utf8')) && !f.startsWith('lib/generated'));
    expect(offenders).toEqual([]);
  });
});
