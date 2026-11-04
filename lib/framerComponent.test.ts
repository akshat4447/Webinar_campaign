import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import vm from 'node:vm';
import { escapeForTemplateLiteral, generateFramerComponent, studioScriptSource } from './framerComponent';

const OPTS = { apiOrigin: 'https://current-tunnel.trycloudflare.com/', campaignId: 'cmwcurrentwebinar0000001', zoomId: '81234567891', landingUrl: 'https://my-landing-page.framer.app/' };

/** The text of the STUDIO_SCRIPT constant, read back the way the browser will read it. */
function embeddedScript(file: string): string {
  const m = /const STUDIO_SCRIPT = (`(?:[^`\\]|\\[\s\S])*`)\n/.exec(file);
  if (!m) throw new Error('script constant not found');
  return vm.runInNewContext(m[1]) as string;
}

describe('escapeForTemplateLiteral', () => {
  it('reads back as exactly the original, whatever it contains', () => {
    for (const t of ['plain', 'a\\b', 'a\\\\b', 'tick ` tick', '${notAVariable}', '$/ and $& and $\' and $1', '\\`', '\\${x}', 'line1\nline2\ttab', '/^[A-Za-z0-9_-]{8,64}$/.test(x)', '']) {
      expect(vm.runInNewContext('`' + escapeForTemplateLiteral(t) + '`'), JSON.stringify(t)).toBe(t);
    }
  });
});

describe('generateFramerComponent', () => {
  const file = generateFramerComponent(OPTS);

  it('is a valid component file that parses with no errors', () => {
    const r = ts.transpileModule(file, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext }, reportDiagnostics: true });
    expect((r.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error)).toEqual([]);
  });

  it('embeds Studio\'s script for this webinar exactly, character for character', () => {
    expect(embeddedScript(file)).toBe(studioScriptSource({ ...OPTS, apiOrigin: 'https://current-tunnel.trycloudflare.com' }));
  });

  it('is valid JavaScript once the script is read back out of it', () => {
    expect(() => new vm.Script(embeddedScript(file))).not.toThrow();
  });

  it('carries the address, the webinar and the Zoom event in the script and in the header, and nowhere that can go stale', () => {
    const script = embeddedScript(file);
    expect(script).toContain('apiOrigin: "https://current-tunnel.trycloudflare.com"');
    expect(script).toContain('cmwcurrentwebinar0000001');
    expect(script).toContain('81234567891');
    expect(file).toContain('Studio address : https://current-tunnel.trycloudflare.com');
    expect(file).toContain('Webinar        : cmwcurrentwebinar0000001');
    // not a property of the component, so no value saved on a page can override it
    const props = file.slice(file.indexOf('addPropertyControls(UniversalWebinarLanding'));
    expect(props).not.toMatch(/apiOrigin|campaignId|zoomId/);
    const signature = file.slice(file.indexOf('export default function'), file.indexOf('}) {'));
    expect(signature).not.toMatch(/apiOrigin|campaignId|zoomId/);
  });

  it('leaves no placeholder behind, and has none of the old hidden fields', () => {
    expect(file).not.toMatch(/__[A-Z_]+__/);
    // the form's markup, not the script (whose selectors name these fields on purpose)
    const markup = file.replace(/const STUDIO_SCRIPT = `(?:[^`\\]|\\[\s\S])*`\n/, '');
    expect(markup).not.toMatch(/name="mx_WebinarID"|name="campaignId"|name="mx_Channel_Source"|type="hidden"/);
  });

  it('installs the script once, and not on the editing canvas', () => {
    expect(file).toContain('RenderTarget.current() === RenderTarget.canvas');
    expect(file).toContain('document.getElementById(STUDIO_SCRIPT_ID)');
  });

  it('keeps the field names the script reads', () => {
    for (const n of ['FirstName', 'LastName', 'EmailAddress', 'Phone', 'Company', 'JobTitle']) expect(file).toContain(`name="${n}"`);
  });

  it('is generated the same way every time', () => {
    expect(generateFramerComponent(OPTS)).toBe(file);
  });

  it('reflects another address, webinar and Zoom event, and is no longer the same file', () => {
    const other = generateFramerComponent({ apiOrigin: 'https://studio.leadsquared.com', campaignId: 'cmwabcdefgh12345', zoomId: '81234567891' });
    expect(other).not.toBe(file);
    expect(embeddedScript(other)).toContain('apiOrigin: "https://studio.leadsquared.com"');
    expect(other).not.toContain('current-tunnel');
    expect(other).not.toContain('cmwcurrentwebinar0000001');
  });

  it('copes with a webinar that has no Zoom event yet', () => {
    const none = generateFramerComponent({ ...OPTS, zoomId: null });
    expect(none).toContain('Zoom event     : (none)');
    expect(() => new vm.Script(embeddedScript(none))).not.toThrow();
  });

  it('refuses a value that could break out of the file', () => {
    expect(() => generateFramerComponent({ ...OPTS, apiOrigin: 'javascript:alert(1)' })).toThrow(/valid web address/);
    expect(() => generateFramerComponent({ ...OPTS, apiOrigin: 'not a url' })).toThrow(/valid web address/);
    expect(() => generateFramerComponent({ ...OPTS, campaignId: 'x"; alert(1); //' })).toThrow(/webinar id/);
    expect(() => generateFramerComponent({ ...OPTS, campaignId: '' })).toThrow(/webinar id/);
    // an odd Zoom id is dropped, never written into the file
    expect(generateFramerComponent({ ...OPTS, zoomId: '1"; evil()' })).toContain('Zoom event     : (none)');
  });
});
