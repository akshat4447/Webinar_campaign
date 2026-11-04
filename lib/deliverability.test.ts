import { describe, expect, it } from 'vitest';
import { deliverabilityNotes, shownLinkAddress } from './deliverability';

const ok = { appOrigin: 'https://studio.leadsquared.com', mode: 'external' as const, landingUrl: 'https://webinar.leadsquared.com/ai', fromEmail: 'events@mail.example.org', recipientEmails: ['a@gmail.com'] };

describe('deliverabilityNotes', () => {
  it('has nothing to say for an own-domain landing page, an own-domain Studio and outside recipients', () => {
    expect(deliverabilityNotes(ok)).toEqual([]);
  });

  it('flags a landing page on a free builder address when Studio has no better address to show instead', () => {
    const notes = deliverabilityNotes({ ...ok, appOrigin: 'https://x.trycloudflare.com', landingUrl: 'https://my-landing-page.framer.app/' });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('my-landing-page.framer.app');
    expect(notes[0]).toContain('free address');
  });

  it('says nothing about the free page when Studio\'s own better address is shown instead', () => {
    expect(deliverabilityNotes({ ...ok, landingUrl: 'https://my-landing-page.framer.app/' })).toEqual([]);
    expect(shownLinkAddress({ ...ok, landingUrl: 'https://my-landing-page.framer.app/' })).toBe('https://studio.leadsquared.com');
  });

  it('flags a temporary Studio address in zoom mode, where every link points at Studio', () => {
    const notes = deliverabilityNotes({ ...ok, mode: 'zoom', landingUrl: null, appOrigin: 'http://localhost:3000' });
    expect(notes[0]).toContain('localhost');
    expect(notes[0]).toContain('temporary');
  });

  it('flags recipients at the sender\'s own company, once, with the right count', () => {
    const notes = deliverabilityNotes({ ...ok, fromEmail: 'events@digital.leadsquared.com', recipientEmails: ['person.one@leadsquared.com', 'k@LeadSquared.com', 'x@gmail.com', null, undefined] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2 recipients are');
  });

  it('reports both problems together, and copes with no sender or no recipients', () => {
    const both = deliverabilityNotes({ appOrigin: 'http://localhost:3000', mode: 'zoom', fromEmail: 'e@digital.leadsquared.com', recipientEmails: ['a@leadsquared.com'] });
    expect(both).toHaveLength(2);
    expect(deliverabilityNotes({ ...ok, fromEmail: undefined, recipientEmails: [] })).toEqual([]);
  });
});
