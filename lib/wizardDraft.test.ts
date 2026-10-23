import { describe, it, expect } from 'vitest';
import {
  applyPatchToFields,
  conflictGroupOf,
  conflictingGroups,
  diffDraftFields,
  groupsInPatch,
  integrationsHref,
  mergePatches,
  nextFurthestStep,
  remoteChangedGroups,
  returnTarget,
  safeReturnTo,
  sanitizeDraftPatch,
  sanitizeGroupBases,
  shouldCreateDraft,
  stampGroups,
  subtractPatch,
  wizardProgressPercent,
  wizardResumeHref,
  wizardStepLabel,
  type DraftFields,
} from './wizardDraft';

const base: DraftFields = {
  title: '', description: '', date: '', time: '', timezone: 'Asia/Kolkata', durationMinutes: 60, capacity: '',
  registrationLink: '', zoomLink: '', zoomMeetingId: '', speakers: [],
  selectedChannels: ['email_campaign'], scoringPrompt: 'p', scoringCriteria: 'c', scoringThreshold: 70,
  msgMode: 'ai', tone: 'Warm', msgLength: 'Short', aiInstructions: 'a', brief: 'b', oneClickSignup: true,
  personalizationFields: ['firstName'],
};

describe('sanitizeDraftPatch', () => {
  it('keeps known fields and drops everything else', () => {
    const p = sanitizeDraftPatch({ title: 'Hello', status: 'live', cadenceStatus: 'running', id: 'x', zoomMode: 'new', launchedAt: 'now' });
    expect(p).toEqual({ title: 'Hello' });
  });

  it('accepts half-typed input without rejecting the save', () => {
    expect(sanitizeDraftPatch({ title: 'ab', capacity: '' })).toEqual({ title: 'ab', capacity: '' });
  });

  it('saves a usable landing page address, clears a blank one, and never stores one that is not a web address', () => {
    expect(sanitizeDraftPatch({ registrationLink: ' https://pages.example.com/w ' }).registrationLink).toBe('https://pages.example.com/w');
    expect(sanitizeDraftPatch({ registrationLink: 'pages.example.com/w' }).registrationLink).toBe('pages.example.com/w');
    expect(sanitizeDraftPatch({ registrationLink: '' }).registrationLink).toBe('');
    // Half typed or wrong: the rest of the patch still saves, the address does not.
    for (const bad of ['https://exa', 'javascript:alert(1)', 'not a url', 'htp://pages.example.com', 'https://user:pw@pages.example.com']) {
      expect(sanitizeDraftPatch({ title: 'ab', registrationLink: bad }), bad).toEqual({ title: 'ab' });
    }
  });

  it('bounds lengths and strips control characters and line breaks from one-line fields', () => {
    const p = sanitizeDraftPatch({ title: `a\u0000b\nc${'x'.repeat(500)}`, description: 'd'.repeat(9000) });
    expect(p.title).not.toMatch(/[\u0000\n]/);
    expect(p.title!.length).toBeLessThanOrEqual(200);
    expect(p.description!.length).toBe(5000);
  });

  it('validates dates, times, numbers and enums', () => {
    expect(sanitizeDraftPatch({ date: '2026-13-99x', time: '9am', durationMinutes: 99999, capacity: '12abc', msgMode: 'robot', scoringThreshold: 500 }))
      .toEqual({ durationMinutes: 720, scoringThreshold: 100 });
    expect(sanitizeDraftPatch({ date: '2026-10-21', time: '15:00', capacity: '500' })).toEqual({ date: '2026-10-21', time: '15:00', capacity: '500' });
  });

  it('replaces an unknown timezone with a safe one', () => {
    expect(sanitizeDraftPatch({ timezone: 'Mars/Olympus' }).timezone).toBe('Asia/Kolkata');
    expect(sanitizeDraftPatch({ timezone: 'Europe/London' }).timezone).toBe('Europe/London');
  });

  it('filters channels to known keys and falls back to the defaults when none are left', () => {
    expect(sanitizeDraftPatch({ selectedChannels: ['email_campaign', 'bogus', 'email_campaign'] }).selectedChannels).toEqual(['email_campaign']);
    expect(sanitizeDraftPatch({ selectedChannels: ['bogus'] }).selectedChannels!.length).toBeGreaterThan(1);
  });

  it('cleans speakers and per-step configs', () => {
    const p = sanitizeDraftPatch({
      speakers: [{ name: 'Ada', isPrimary: true }, { name: '   ' }, 'x', null],
      stepConfigs: { invite: { mode: 'template', customBody: 'Hi', templateId: 'tpl_1' }, 'bad key!': { mode: 'ai' }, nudge: { mode: 'weird' } },
    });
    expect(p.speakers).toHaveLength(1);
    expect(p.speakers![0].name).toBe('Ada');
    expect(Object.keys(p.stepConfigs!)).toEqual(['invite']);
  });

  it('returns an empty patch for non-objects', () => {
    for (const v of [null, undefined, 'x', 4, [], [{ title: 'a' }]]) expect(sanitizeDraftPatch(v)).toEqual({});
  });
});

describe('shouldCreateDraft', () => {
  it('needs a 3 character title, or another field holding a value', () => {
    expect(shouldCreateDraft({})).toBe(false);
    expect(shouldCreateDraft({ title: 'ab' })).toBe(false);
    expect(shouldCreateDraft({ title: '  ab  ' })).toBe(false);
    expect(shouldCreateDraft({ title: 'abc' })).toBe(true);
    expect(shouldCreateDraft({ description: 'something' })).toBe(true);
    expect(shouldCreateDraft({ title: 'a', description: '   ' })).toBe(false);
    expect(shouldCreateDraft({ speakers: [] })).toBe(false);
    expect(shouldCreateDraft({ date: '2026-10-21' })).toBe(true);
  });
});

describe('patch maths', () => {
  it('merges later changes over earlier ones and merges per-step configs per step', () => {
    const m = mergePatches({ title: 'a', stepConfigs: { invite: { mode: 'ai' } } }, { title: 'ab', stepConfigs: { invite: { instruction: 'x' }, nudge: { mode: 'template' } } });
    expect(m.title).toBe('ab');
    expect(m.stepConfigs).toEqual({ invite: { mode: 'ai', instruction: 'x' }, nudge: { mode: 'template' } });
  });

  it('diffs only changed fields, and a conflict group travels whole', () => {
    const next = { ...base, time: '10:00' };
    const d = diffDraftFields({ ...base, date: '2026-10-21' }, { ...next, date: '2026-10-21' });
    expect(Object.keys(d).sort()).toEqual(['date', 'time', 'timezone']);
    expect(diffDraftFields(base, { ...base, title: 'x' })).toEqual({ title: 'x' });
    expect(diffDraftFields(base, base)).toEqual({});
  });

  it('compares arrays by value', () => {
    expect(diffDraftFields(base, { ...base, selectedChannels: ['email_campaign'] })).toEqual({});
    expect(Object.keys(diffDraftFields(base, { ...base, selectedChannels: ['sms'] }))).toEqual(['selectedChannels']);
  });

  it('subtracts what was saved but keeps anything edited again meanwhile', () => {
    expect(subtractPatch({ title: 'abc', description: 'x' }, { title: 'abc' })).toEqual({ description: 'x' });
    expect(subtractPatch({ title: 'abcd' }, { title: 'abc' })).toEqual({ title: 'abcd' });
    expect(subtractPatch({ stepConfigs: { a: { mode: 'ai' }, b: { mode: 'ai' } } }, { stepConfigs: { a: { mode: 'ai' } } })).toEqual({ stepConfigs: { b: { mode: 'ai' } } });
  });

  it('applies a patch to full field values', () => {
    expect(applyPatchToFields(base, { title: 'T', tone: 'Bold' }).title).toBe('T');
    expect(applyPatchToFields(base, {}).tone).toBe('Warm');
  });
});

describe('conflict groups and revisions', () => {
  it('groups fields that must be saved together', () => {
    expect(conflictGroupOf('date')).toBe('schedule');
    expect(conflictGroupOf('time')).toBe('schedule');
    expect(conflictGroupOf('registrationLink')).toBe('registration');
    expect(conflictGroupOf('zoomMeetingId')).toBe('zoom');
    expect(conflictGroupOf('title')).toBe('title');
    expect(groupsInPatch({ date: 'x', time: 'y', title: 'z', stepConfigs: { invite: {} } }).sort()).toEqual(['schedule', 'stepConfigs.invite', 'title']);
  });

  it('two writers on different fields do not conflict; the same field does', () => {
    const revs = stampGroups({}, { title: 'A' }, 3); // someone else wrote the title at revision 3
    expect(conflictingGroups({ description: 'mine' }, revs, 2)).toEqual([]);
    expect(conflictingGroups({ title: 'mine' }, revs, 2)).toEqual(['title']);
    expect(conflictingGroups({ title: 'mine' }, revs, 3)).toEqual([]); // a writer who has seen revision 3
  });

  it('a writer knows its own writes: per-group bases stop it clashing with itself', () => {
    const revs = { description: 7, title: 6 };
    // loaded at 5; wrote the description at 7 itself; never saw the title change at 6
    expect(conflictingGroups({ description: 'again' }, revs, 5)).toEqual(['description']);
    expect(conflictingGroups({ description: 'again' }, revs, 5, { description: 7 })).toEqual([]);
    expect(conflictingGroups({ title: 'mine' }, revs, 5, { description: 7 })).toEqual(['title']);
    expect(conflictingGroups({ title: 'mine' }, revs, 5, { description: 7, title: 6 })).toEqual([]);
    expect(remoteChangedGroups({ description: 'x' }, revs, 5, { description: 7 })).toEqual(['title']);
    expect(sanitizeGroupBases({ a: 3, b: -1, c: 'x', d: 2.7 })).toEqual({ a: 3, d: 2 });
    expect(sanitizeGroupBases([1, 2])).toEqual({});
  });

  it('reports groups changed by others that this patch did not write', () => {
    const revs = { title: 4, description: 1 };
    expect(remoteChangedGroups({ description: 'x' }, revs, 2)).toEqual(['title']);
    expect(remoteChangedGroups({ title: 'x' }, revs, 2)).toEqual([]);
  });
});

describe('steps', () => {
  it('furthest step is a high-water mark and steps are clamped', () => {
    expect(nextFurthestStep(3, 1)).toBe(3);
    expect(nextFurthestStep(1, 4)).toBe(4);
    expect(nextFurthestStep(0, 99)).toBe(5);
    expect(nextFurthestStep(0, -4)).toBe(0);
  });
  it('labels and links', () => {
    expect(wizardStepLabel(2)).toBe('Step 3 of 6');
    expect(wizardStepLabel(undefined)).toBe('Step 1 of 6');
    expect(wizardResumeHref({ id: 'abc', wizardStep: 4 })).toBe('/campaigns/new?id=abc&step=4');
    expect(wizardResumeHref({ id: 'a b' })).toBe('/campaigns/new?id=a%20b&step=0');
    expect(wizardProgressPercent(0)).toBe(17);
    expect(wizardProgressPercent(5)).toBe(100);
  });
});

describe('safeReturnTo', () => {
  it('accepts the wizard and a webinar tab, rebuilt from parsed parts', () => {
    expect(safeReturnTo('/campaigns/new?id=abc123&step=2')).toBe('/campaigns/new?id=abc123&step=2');
    expect(safeReturnTo('/campaigns/new?id=abc123')).toBe('/campaigns/new?id=abc123');
    expect(safeReturnTo('/campaigns/abc123/overview')).toBe('/campaigns/abc123/overview');
    // extra parameters are dropped rather than echoed
    expect(safeReturnTo('/campaigns/new?id=abc&step=1&next=https://evil.test')).toBe('/campaigns/new?id=abc&step=1');
    expect(safeReturnTo('/campaigns/abc/overview?x=1#frag')).toBe('/campaigns/abc/overview');
  });

  it.each([
    ['absolute url', 'https://evil.test/campaigns/new?id=a'],
    ['protocol relative', '//evil.test/campaigns/new?id=a'],
    ['javascript', 'javascript:alert(1)'],
    ['backslash', '/campaigns\\new?id=a'],
    ['backslash lead', '/\\evil.test'],
    ['encoded slash', '/%2Fevil.test'],
    ['encoded backslash', '/campaigns/%5Cevil/overview'],
    ['encoded path', '/campaigns/%6Eew?id=a'],
    ['other page', '/integrations'],
    ['root', '/'],
    ['no id', '/campaigns/new'],
    ['bad id chars', '/campaigns/new?id=a%20b'],
    ['bad id traversal', '/campaigns/new?id=../../x'],
    ['bad step', '/campaigns/new?id=a&step=9x'],
    ['deep path', '/campaigns/abc/overview/extra'],
    ['new as id', '/campaigns/new/overview'],
    ['control char', '/campaigns/new?id=a\u0000'],
    ['newline', '/campaigns/new?id=a\n'],
    ['empty', ''],
    ['not a string', 42 as unknown as string],
    ['too long', `/campaigns/new?id=${'a'.repeat(400)}`],
  ])('rejects %s', (_label, value) => {
    expect(safeReturnTo(value)).toBeNull();
  });

  it('clamps an out-of-range step instead of trusting it', () => {
    expect(safeReturnTo('/campaigns/new?id=a&step=9')).toBe('/campaigns/new?id=a&step=5');
  });

  it('builds an Integrations link only for a safe target, and names the webinar it points at', () => {
    expect(integrationsHref('/campaigns/new?id=a&step=2')).toBe('/integrations?returnTo=%2Fcampaigns%2Fnew%3Fid%3Da%26step%3D2');
    expect(integrationsHref('https://evil.test')).toBe('/integrations');
    expect(integrationsHref(null)).toBe('/integrations');
    expect(returnTarget('/campaigns/new?id=a&step=2')).toEqual({ id: 'a', step: 2 });
    expect(returnTarget('/campaigns/abc/overview')).toEqual({ id: 'abc', step: null });
    expect(returnTarget(null)).toBeNull();
  });
});
