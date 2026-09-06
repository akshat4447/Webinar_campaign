import { describe, it, expect } from 'vitest';
import { renderMergeFields, KNOWN_MERGE_VARS } from './mergeFields';
import { validateTemplateContent } from './messageValidation';
import { normalizeChannel, DEFAULT_ENABLED_CHANNELS } from './channels';
import { cadenceStepsData } from './demo-data';

describe('Webinar Data & Template Synchronization', () => {
  it('renderMergeFields resolves date and speaker in addition to standard tokens', () => {
    const template = 'Hi {{firstName}}, join {{speaker}} on {{date}} for {{topic}} at {{company}}. Link: {{link}}';
    const contact = {
      name: 'John Doe',
      account: 'Acme Corp',
      email: 'john@example.com',
      title: 'VP Sales',
    };
    const campaign = {
      name: 'Modern AI Architecture',
      date: 'Sep 15, 2026 · 3:00 PM IST',
      speakerName: 'Dr. Sarah Connor',
      zoomLink: 'https://zoom.us/j/123456789',
      registrationLink: null,
    };

    const rendered = renderMergeFields(template, {
      firstName: contact.name.split(' ')[0],
      company: contact.account,
      topic: campaign.name,
      link: campaign.zoomLink || '',
      date: campaign.date,
      speaker: campaign.speakerName,
    });

    expect(rendered).toContain('Hi John,');
    expect(rendered).toContain('join Dr. Sarah Connor');
    expect(rendered).toContain('on Sep 15, 2026 · 3:00 PM IST');
    expect(rendered).toContain('for Modern AI Architecture');
    expect(rendered).toContain('at Acme Corp.');
    expect(rendered).toContain('Link: https://zoom.us/j/123456789');
    expect(rendered).not.toContain('{{');
  });

  it('renderMergeFields resolves lastName when supplied, and blanks it when not', () => {
    const template = 'Hi {{firstName}} {{lastName}},';
    const opts = { firstName: 'John', company: 'Acme', topic: 'x', link: 'https://x' };
    expect(renderMergeFields(template, { ...opts, lastName: 'Doe' })).toBe('Hi John Doe,');
    expect(renderMergeFields(template, opts)).toBe('Hi John ,');
  });

  it('KNOWN_MERGE_VARS includes speaker and date for template validation', () => {
    expect(KNOWN_MERGE_VARS).toContain('speaker');
    expect(KNOWN_MERGE_VARS).toContain('date');

    const templateWithSpeaker = 'Hear from {{speaker}} on {{date}} at {{topic}}! Join here: {{link}}';
    const res = validateTemplateContent('Join {{topic}}', templateWithSpeaker, true, KNOWN_MERGE_VARS);
    expect(res.valid).toBe(true);
    expect(res.issues.filter((i) => i.severity === 'error')).toHaveLength(0);
  });

  it('Default channel enablement enables email and linkedin, while disabling optional channels by default', () => {
    const emailSteps = cadenceStepsData.filter((s) => normalizeChannel(s.channel) === 'email');
    const linkedinSteps = cadenceStepsData.filter((s) => normalizeChannel(s.channel) === 'linkedin');
    const smsSteps = cadenceStepsData.filter((s) => normalizeChannel(s.channel) === 'sms');
    const whatsappSteps = cadenceStepsData.filter((s) => normalizeChannel(s.channel) === 'whatsapp');

    expect(emailSteps.length).toBeGreaterThan(0);
    expect(linkedinSteps.length).toBeGreaterThan(0);
    expect(smsSteps.length).toBeGreaterThan(0);
    expect(whatsappSteps.length).toBeGreaterThan(0);

    for (const s of emailSteps) {
      const isDefaultEnabled = s.toggleable && DEFAULT_ENABLED_CHANNELS.has(normalizeChannel(s.channel));
      expect(isDefaultEnabled).toBe(true);
    }

    for (const s of linkedinSteps) {
      const isDefaultEnabled = s.toggleable && DEFAULT_ENABLED_CHANNELS.has(normalizeChannel(s.channel));
      expect(isDefaultEnabled).toBe(true);
    }

    for (const s of smsSteps) {
      const isDefaultEnabled = s.toggleable && DEFAULT_ENABLED_CHANNELS.has(normalizeChannel(s.channel));
      expect(isDefaultEnabled).toBe(false);
    }

    for (const s of whatsappSteps) {
      const isDefaultEnabled = s.toggleable && DEFAULT_ENABLED_CHANNELS.has(normalizeChannel(s.channel));
      expect(isDefaultEnabled).toBe(false);
    }
  });
});
