import { describe, it, expect } from 'vitest';
import { renderMergeFields, KNOWN_MERGE_VARS } from './mergeFields';

describe('Multi-Campaign Template Copying & Merge Field Fallbacks', () => {
  it('renderMergeFields resolves aliases: {{webinarTitle}}, {{speakerName}}, {{zoomLink}}, and {{dateTime}}', () => {
    const raw = 'Join {{speakerName}} for {{webinarTitle}} on {{dateTime}}! Link: {{zoomLink}}';
    const out = renderMergeFields(raw, {
      firstName: 'Alex',
      company: 'TechCorp',
      topic: 'AI Summit',
      webinarTitle: 'AI Summit 2026',
      link: 'https://zoom.us/j/1234',
      speakerName: 'Dr. Sarah Chen',
      dateTime: 'Oct 20, 2026',
    });

    expect(out).toContain('Join Dr. Sarah Chen');
    expect(out).toContain('for AI Summit 2026');
    expect(out).toContain('on Oct 20, 2026');
    expect(out).toContain('Link: https://zoom.us/j/1234');
    expect(out).not.toContain('{{');
  });

  it('renderMergeFields applies safe fallbacks when optional variables are empty', () => {
    const raw = 'Hello {{firstName}}, welcome to {{webinarTitle}} with {{speakerName}} at {{company}}. Link: {{zoomLink}}';
    const out = renderMergeFields(raw, {
      firstName: '',
      company: '',
      topic: '',
      link: '',
    });

    expect(out).toContain('Hello there,');
    expect(out).toContain('welcome to our upcoming webinar');
    expect(out).toContain('with our featured speaker');
    expect(out).toContain('at your team.');
    expect(out).toContain('Link: #');
    expect(out).not.toContain('{{');
  });

  it('KNOWN_MERGE_VARS includes all supported aliases for validation', () => {
    expect(KNOWN_MERGE_VARS).toContain('webinarTitle');
    expect(KNOWN_MERGE_VARS).toContain('speakerName');
    expect(KNOWN_MERGE_VARS).toContain('speakerTitle');
    expect(KNOWN_MERGE_VARS).toContain('zoomLink');
    expect(KNOWN_MERGE_VARS).toContain('dateTime');
    expect(KNOWN_MERGE_VARS).toContain('account');
  });
});
