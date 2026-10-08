import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseActiveFields, buildPersonalizeContact, generatePersonalized, regenerateOne } from './personalization';
import { updateContactFieldsAction, switchStepToFixedTemplateAction } from './actions/personalize';
import * as messageTemplates from './messageTemplates';
import { renderMergeFields } from './mergeFields';
import type { Campaign, Contact, ActivityLogEntry, CadenceStep } from '@/lib/generated/prisma/client';
import { db } from './db';

describe('Messaging Personalization Engine & UI Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Grounding Fields Selection (parseActiveFields & buildPersonalizeContact)', () => {
    it('defaults to all 7 core fields when campaign has no personalizationFields set', () => {
      const active = parseActiveFields(null);
      expect(active.has('firstName')).toBe(true);
      expect(active.has('title')).toBe(true);
      expect(active.has('seniority')).toBe(true);
      expect(active.has('function')).toBe(true);
      expect(active.has('account')).toBe(true);
      expect(active.has('vertical')).toBe(true);
      expect(active.has('score')).toBe(true);
      expect(active.has('personaNote')).toBe(false);
    });

    it('correctly parses custom comma-separated active field sets', () => {
      const active = parseActiveFields('firstName, account, personaNote');
      expect(active.has('firstName')).toBe(true);
      expect(active.has('account')).toBe(true);
      expect(active.has('personaNote')).toBe(true);
      expect(active.has('title')).toBe(false);
      expect(active.has('seniority')).toBe(false);
    });

    it('buildPersonalizeContact filters out disabled fields to ground Claude strictly on selected inputs', () => {
      const rawContact = {
        id: 'c1',
        name: 'Sarah Connor',
        title: 'Chief Technology Officer',
        function: 'Engineering',
        seniority: 'C-Level',
        account: 'Cyberdyne Systems',
        vertical: 'Robotics',
        personaNote: 'Prefers deep-dive architecture over sales pitches',
        score: 95,
        explanation: 'Direct ICP fit with high budget authority',
        linkedinId: 'sarah-connor-123',
      };

      // Only firstName and account are enabled
      const restrictedFields = new Set(['firstName', 'account']);
      const filtered = buildPersonalizeContact(rawContact, restrictedFields);

      expect(filtered.name).toBe('Sarah Connor');
      expect(filtered.account).toBe('Cyberdyne Systems');
      // Disabled fields should be blanked out or nullified
      expect(filtered.title).toBe('');
      expect(filtered.function).toBe('');
      expect(filtered.seniority).toBe('');
      expect(filtered.vertical).toBe('');
      expect(filtered.personaNote).toBeNull();
      expect(filtered.score).toBeNull();
      expect(filtered.scoreRationale).toBeNull();
    });

    it('buildPersonalizeContact preserves all signals when all fields are active', () => {
      const rawContact = {
        id: 'c2',
        name: 'Alex Rivera',
        title: 'Head of Growth',
        function: 'Marketing',
        seniority: 'Director',
        account: 'Acme Corp',
        vertical: 'SaaS',
        personaNote: 'Looking to scale webinar conversion',
        score: 88,
        explanation: 'Strong functional alignment',
        linkedinId: null,
      };

      const allFields = new Set(['firstName', 'title', 'function', 'seniority', 'account', 'vertical', 'score', 'personaNote']);
      const contact = buildPersonalizeContact(rawContact, allFields);

      expect(contact.name).toBe('Alex Rivera');
      expect(contact.title).toBe('Head of Growth');
      expect(contact.function).toBe('Marketing');
      expect(contact.seniority).toBe('Director');
      expect(contact.account).toBe('Acme Corp');
      expect(contact.vertical).toBe('SaaS');
      expect(contact.personaNote).toBe('Looking to scale webinar conversion');
      expect(contact.score).toBe(88);
      expect(contact.scoreRationale).toBe('Strong functional alignment');
      expect(contact.hasLinkedIn).toBe(false);
    });
  });

  describe('Sent Dispatched Guards (Pending vs Dispatched)', () => {
    it('generatePersonalized rejects execution when cadenceSend count shows step is already dispatched', async () => {
      vi.spyOn(db.campaign, 'findUniqueOrThrow').mockResolvedValueOnce({
        id: 'camp_123',
        name: 'Webinar',
        brief: 'brief',
        personalizationPrompt: 'prompt',
        personalizationFields: 'firstName,account',
      } as unknown as Campaign);
      vi.spyOn(messageTemplates, 'resolveStepTemplate').mockResolvedValueOnce({
        id: 'tmpl_1',
        source: 'library',
        label: 'Invite',
        channel: 'email',
        hasSubject: true,
        subject: 'Subject',
        body: 'Body',
        hidden: false,
        status: 'ready',
        dltTemplateId: null,
        senderId: null,
      });
      vi.spyOn(db.contact, 'findMany').mockResolvedValueOnce([]);
      vi.spyOn(db.speaker, 'findMany').mockResolvedValueOnce([]);
      vi.spyOn(db.cadenceStep, 'findFirst').mockResolvedValueOnce({ mode: 'ai', instruction: null } as unknown as CadenceStep);
      const countSpy = vi.spyOn(db.cadenceSend, 'count').mockResolvedValueOnce(42);

      const result = await generatePersonalized('camp_123', 'invite');

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp_123',
          stepKey: 'invite',
          status: 'sent',
        },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('already been sent (42 sent)');
      expect(result.error).toContain('locked from regeneration');
    });

    it('regenerateOne rejects execution when cadenceSend count shows step is already dispatched', async () => {
      vi.spyOn(db.campaign, 'findUniqueOrThrow').mockResolvedValueOnce({
        id: 'camp_123',
        name: 'Webinar',
        brief: 'brief',
        personalizationPrompt: 'prompt',
        personalizationFields: 'firstName,account',
      } as unknown as Campaign);
      vi.spyOn(messageTemplates, 'resolveStepTemplate').mockResolvedValueOnce({
        id: 'tmpl_1',
        source: 'library',
        label: 'Invite',
        channel: 'email',
        hasSubject: true,
        subject: 'Subject',
        body: 'Body',
        hidden: false,
        status: 'ready',
        dltTemplateId: null,
        senderId: null,
      });
      vi.spyOn(db.contact, 'findUniqueOrThrow').mockResolvedValueOnce({
        id: 'cont_456',
        name: 'John',
      } as unknown as Contact);
      vi.spyOn(db.speaker, 'findMany').mockResolvedValueOnce([]);
      vi.spyOn(db.cadenceStep, 'findFirst').mockResolvedValueOnce({ mode: 'ai', instruction: null } as unknown as CadenceStep);
      const countSpy = vi.spyOn(db.cadenceSend, 'count').mockResolvedValueOnce(5);

      const result = await regenerateOne('camp_123', 'cont_456', 'nudge');

      expect(countSpy).toHaveBeenCalledWith({
        where: {
          campaignId: 'camp_123',
          stepKey: 'nudge',
          status: 'sent',
        },
      });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('already been dispatched');
    });
  });

  describe('Fixed Template vs AI Mode Switching', () => {
    it('switchStepToFixedTemplateAction switches pending step to template mode non-destructively without deleting drafts', async () => {
      const sendCountSpy = vi.spyOn(db.cadenceSend, 'count').mockResolvedValueOnce(0);
      const stepUpdateSpy = vi.spyOn(db.cadenceStep, 'updateMany').mockResolvedValueOnce({ count: 1 });
      const deleteMsgsSpy = vi.spyOn(db.personalizedMessage, 'deleteMany');
      vi.spyOn(db.activityLogEntry, 'create').mockResolvedValueOnce({} as unknown as ActivityLogEntry);

      const res = await switchStepToFixedTemplateAction('camp_123', 'invite', 'tmpl_789');

      expect(sendCountSpy).toHaveBeenCalledWith({
        where: { campaignId: 'camp_123', stepKey: 'invite', status: 'sent' },
      });
      expect(stepUpdateSpy).toHaveBeenCalledWith({
        where: { campaignId: 'camp_123', key: 'invite' },
        data: { mode: 'template', templateId: 'tmpl_789' },
      });
      expect(deleteMsgsSpy).not.toHaveBeenCalled();
      expect(res.ok).toBe(true);
    });

    it('switchStepToFixedTemplateAction blocks switching if step has already sent messages', async () => {
      vi.spyOn(db.cadenceSend, 'count').mockResolvedValueOnce(12);

      const res = await switchStepToFixedTemplateAction('camp_123', 'invite', 'tmpl_789');
      expect(res.ok).toBe(false);
      expect(res.error).toContain('already been sent');
    });
  });

  describe('Inline Contact Field Editing', () => {
    it('updateContactFieldsAction updates contact fields with clean trimmed strings', async () => {
      const updateSpy = vi.spyOn(db.contact, 'update').mockResolvedValueOnce({
        id: 'cont_1',
        campaignId: 'camp_1',
        name: 'Jane Doe',
        title: 'VP Operations',
        seniority: 'VP',
        function: 'Operations',
        account: 'Tech Innovations Ltd',
        vertical: 'Cloud Infrastructure',
        personaNote: 'Requested executive summary',
      } as unknown as Contact);

      const res = await updateContactFieldsAction('camp_1', 'cont_1', {
        name: '  Jane Doe  ',
        title: ' VP Operations ',
        seniority: ' VP ',
        function: ' Operations ',
        account: ' Tech Innovations Ltd ',
        vertical: ' Cloud Infrastructure ',
        personaNote: ' Requested executive summary ',
      });

      expect(updateSpy).toHaveBeenCalledWith({
        where: { id: 'cont_1' },
        data: {
          name: 'Jane Doe',
          title: 'VP Operations',
          seniority: 'VP',
          function: 'Operations',
          account: 'Tech Innovations Ltd',
          vertical: 'Cloud Infrastructure',
          personaNote: 'Requested executive summary',
        },
      });
      expect(res.ok).toBe(true);
      expect(res.contact.name).toBe('Jane Doe');
    });
  });

  describe('Live Token Resolution for Messaging Preview', () => {
    it('renderMergeFields resolves all recipient and campaign variables seamlessly', () => {
      const template = 'Hi {{firstName}},\n\nJoin {{speaker}} on {{date}} to discuss {{topic}} at {{company}}.\n\nReserve your seat: {{link}}';
      const rendered = renderMergeFields(template, {
        firstName: 'Elena',
        lastName: 'Rostova',
        company: 'Vanguard Systems',
        topic: 'AI Agents at Enterprise Scale',
        date: 'Thursday, Oct 22 · 4:00 PM EST',
        speaker: 'Dr. Alan Turing',
        link: 'https://webinar.acme.com/r/xyz123',
      });

      expect(rendered).toContain('Hi Elena,');
      expect(rendered).toContain('Join Dr. Alan Turing on Thursday, Oct 22 · 4:00 PM EST');
      expect(rendered).toContain('to discuss AI Agents at Enterprise Scale at Vanguard Systems.');
      expect(rendered).toContain('Reserve your seat: https://webinar.acme.com/r/xyz123');
      expect(rendered).not.toContain('{{');
      expect(rendered).not.toContain('}}');
    });
  });
});
