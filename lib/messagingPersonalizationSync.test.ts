import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateCopyAnglesAction,
  testGenerateAiDraftAction,
  switchStepModeAction,
} from './actions/personalize';
import * as claude from './claude';
import * as personalization from './personalization';
import { db } from './db';

describe('Messaging & Multi-Channel AI Personalization Synchronization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(db.cadenceSend, 'count').mockResolvedValue(0);
    vi.spyOn(db.contact, 'count').mockResolvedValue(0);
    vi.spyOn(db.appSetting, 'findMany').mockResolvedValue([]);
  });

  describe('generateCopyAnglesAction (3 Psychological Copy Angles across Channels)', () => {
    it('generates 3 distinct psychological frameworks for email with subject lines', async () => {
      const res = await generateCopyAnglesAction({
        topic: 'Scaling Enterprise Kubernetes in 2026',
        speakerName: 'Dr. Elena Rostova',
        speakerTitle: 'VP of Platform Architecture',
        channel: 'email',
        stepLabel: 'Strategic Webinar Invite',
      });

      expect(res.angles).toBeDefined();
      expect(res.angles.length).toBe(3);

      const angleIds = res.angles.map((a) => a.id);
      expect(angleIds).toContain('pain_point');
      expect(angleIds).toContain('benchmark_data');
      expect(angleIds).toContain('story_vision');

      // Email angles must have subjects and include topic or speaker
      for (const angle of res.angles) {
        expect(angle.subject).toBeTruthy();
        expect(angle.body).toBeTruthy();
        expect(angle.rationale).toBeTruthy();
      }
    });

    it('generates SMS copy under 280 characters without subject line', async () => {
      const res = await generateCopyAnglesAction({
        topic: 'Executive AI Strategy Forum',
        channel: 'sms',
        stepLabel: 'SMS 1-Hour Reminder',
      });

      expect(res.angles.length).toBe(3);
      for (const angle of res.angles) {
        expect(angle.subject).toBeNull();
        expect(angle.body.length).toBeLessThan(280);
      }
    });

    it('generates LinkedIn message under 80 words without subject line', async () => {
      const res = await generateCopyAnglesAction({
        topic: 'Product Growth Summit',
        channel: 'linkedin',
        stepLabel: 'LinkedIn Peer Touchpoint',
      });

      expect(res.angles.length).toBe(3);
      for (const angle of res.angles) {
        expect(angle.subject).toBeNull();
        const wordCount = angle.body.split(/\s+/).filter(Boolean).length;
        expect(wordCount).toBeLessThan(80);
      }
    });

    it('generates WhatsApp copy with focused call-to-action', async () => {
      const res = await generateCopyAnglesAction({
        topic: 'Fintech Security Masterclass',
        channel: 'whatsapp',
        stepLabel: 'WhatsApp Quick Nudge',
      });

      expect(res.angles.length).toBe(3);
      for (const angle of res.angles) {
        expect(angle.subject).toBeNull();
        expect(angle.body).toContain('{{link}}');
      }
    });

    it('incorporates multi-speaker lineup in generated angle copy', async () => {
      const res = await generateCopyAnglesAction({
        topic: 'Next-Gen Cloud Architecture',
        speakers: [
          { name: 'Alice Chen', title: 'CTO', company: 'Nova Corp' },
          { name: 'Bob Smith', title: 'VP Infrastructure', company: 'Apex Tech' },
        ],
        channel: 'email',
        stepLabel: 'Invitation',
      });

      expect(res.angles.length).toBe(3);
      // At least one angle should feature the multi-speaker lineup
      const combinedBodies = res.angles.map((a) => a.body).join(' ');
      expect(combinedBodies).toMatch(/Alice Chen|Bob Smith/);
    });
  });

  describe('testGenerateAiDraftAction (Live Single-Recipient Test Draft Generation)', () => {
    it('generates a personalized test draft for sample contact across channels', async () => {
      vi.spyOn(claude,'personalizeMessages').mockResolvedValueOnce({failedBatches:0,drafts:[{id:'sample-contact-preview',subject:'Data Governance for LLMs',body:'Hi Sarah, join Data Governance for LLMs with Marcus Vance.',rationale:'Role relevance'}]});
      const res = await testGenerateAiDraftAction({
        topic: 'Data Governance for LLMs',
        speakers: [{ name: 'Marcus Vance', title: 'Chief AI Officer', company: 'Cognitive Dynamics' }],
        channel: 'email',
        stepLabel: 'Executive Invite',
        sampleContact: {
          name: 'Sarah Connor',
          title: 'Head of Data Platforms',
          account: 'Cyberdyne Systems',
          function: 'Data Engineering',
          seniority: 'Director',
          score: 94,
        },
      });

      expect(res.ok).toBe(true);
      expect(res.body).toBeTruthy();
      expect(res.subject).toBeTruthy();
      // Should address the contact by first name
      expect(res.body).toContain('Sarah');
      // Should include the topic
      expect(res.body).toContain('Data Governance for LLMs');
      // Should include speaker
      expect(res.body).toContain('Marcus Vance');
    });

    it('respects SMS constraints in sample test draft', async () => {
      vi.spyOn(claude,'personalizeMessages').mockResolvedValueOnce({failedBatches:0,drafts:[{id:'sample-contact-preview',subject:null,body:'Hi Devin, join Real-Time Event Streaming: https://example.com',rationale:'Concise invitation'}]});
      const res = await testGenerateAiDraftAction({
        topic: 'Real-Time Event Streaming',
        channel: 'sms',
        stepLabel: 'SMS Flash Reminder',
        sampleContact: {
          name: 'Devin Cole',
          title: 'VP Engineering',
          account: 'StreamCorp',
        },
      });

      expect(res.ok).toBe(true);
      expect(res.subject).toBeNull();
      expect(res.body.length).toBeLessThan(300);
      expect(res.body).toContain('Devin');
    });
  });

  it.each(['error','empty'])('does not invent a successful live preview for a %s provider response',async outcome=>{
    const provider=vi.spyOn(claude,'personalizeMessages');
    if(outcome==='error')provider.mockRejectedValueOnce(new Error('Provider unavailable'));else provider.mockResolvedValueOnce({drafts:[],failedBatches:0});
    const result=await testGenerateAiDraftAction({channel:'sms',stepLabel:'Invite',sampleContact:{name:'Test Person',title:'Director',account:'Example'}});
    expect(result).toMatchObject({ok:false,body:'',usedFallback:false});expect(result.error).toBeTruthy();
  });

  describe('switchStepModeAction (Cadence Step Mode & Synchronization)', () => {
    it('switches step to fixed template mode and pins templateId', async () => {
      vi.spyOn(db.cadenceStep, 'updateMany').mockResolvedValueOnce({ count: 1 });
      vi.spyOn(db.activityLogEntry, 'create').mockResolvedValueOnce({} as never);

      const res = await switchStepModeAction('camp-1', 'invite', 'template', 'tpl-pinned-123');
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('template');
      expect(db.cadenceStep.updateMany).toHaveBeenCalledWith({
        where: { campaignId: 'camp-1', key: 'invite' },
        data: expect.objectContaining({
          mode: 'template',
          templateId: 'tpl-pinned-123',
        }),
      });
    });

    it('switches step to AI mode, clears pinned template, and auto-drafts for approved contacts', async () => {
      vi.spyOn(db.cadenceStep, 'updateMany').mockResolvedValueOnce({ count: 1 });
      vi.spyOn(db.activityLogEntry, 'create').mockResolvedValueOnce({} as never);
      vi.spyOn(db.contact, 'count').mockResolvedValueOnce(1);
      vi.spyOn(personalization, 'generatePersonalized').mockResolvedValueOnce({
        ok: true,
        generated: 1,
        messages: [
          {
            contactId: 'c1',
            id: 'pm-1',
            subject: "Alex, you're invited: AI Operations 2026",
            body: 'Alex,\n\nJoin Dr. Smith for AI Operations 2026.\n\nSave seat: https://webinar.example.com/ai-ops',
            rationale: 'Generated for Alex Rivera (VP Eng)',
            status: 'draft',
            linkStale: false,
          },
        ],
      });
      vi.spyOn(db.contact, 'findMany').mockResolvedValueOnce([
        {
          id: 'c1',
          name: 'Alex Rivera',
          title: 'VP Eng',
          account: 'Horizon Labs',
          function: 'Engineering',
          seniority: 'VP',
          vertical: 'Tech',
          score: 95,
          personaNote: null,
          linkedinId: null,
          explanation: null,
        } as never,
      ]);
      vi.spyOn(db.campaign, 'findUnique').mockResolvedValueOnce({
        id: 'camp-1',
        name: 'AI Operations 2026',
        date: '2026-10-15',
        speakerName: 'Dr. Smith',
        speakerTitle: 'Lead AI Architect',
        brief: 'Focus on enterprise ROI',
        tone: 'Action-oriented',
        msgLength: 'Under 100 words',
        aiInstructions: '',
        registrationLink: 'https://webinar.example.com/ai-ops',
        zoomLink: null,
        personalizationFields: null,
      } as never);
      vi.spyOn(db.cadenceStep, 'findFirst').mockResolvedValueOnce({
        key: 'invite',
        title: 'Initial Invitation',
        channel: 'email',
        templateId: null,
      } as never);
      vi.spyOn(db.speaker, 'findMany').mockResolvedValueOnce([]);
      vi.spyOn(db.personalizedMessage, 'upsert').mockResolvedValueOnce({
        id: 'pm-1',
        campaignId: 'camp-1',
        contactId: 'c1',
        stepKey: 'invite',
        subject: "Alex, you're invited: AI Operations 2026",
        body: 'Alex,\n\nJoin Dr. Smith for AI Operations 2026.\n\nSave seat: https://webinar.example.com/ai-ops',
        rationale: 'Generated for Alex Rivera (VP Eng)',
        status: 'draft',
        linkUsed: 'https://webinar.example.com/ai-ops',
        linkStale: false,
      } as never);

      const res = await switchStepModeAction('camp-1', 'invite', 'ai', null, { autoDraft: true });
      expect(res.ok).toBe(true);
      expect(res.mode).toBe('ai');
      expect(res.generated).toBe(1);
      expect(res.messages?.length).toBe(1);
      expect(res.messages?.[0].contactId).toBe('c1');
    });
  });
});
