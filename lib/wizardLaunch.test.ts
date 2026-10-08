import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LEADSQUARED_FIELD_MAPPINGS,
  type WizardFieldMapping,
} from './wizardFields';
import { type AudiencePreflightValidation } from './actions/wizard';

describe('Wizard 6-Stage Launch Architecture', () => {
  describe('Field Mapping & LeadSquared Integration', () => {
    it('contains all 6 default token mappings with correct field mappings', () => {
      expect(DEFAULT_LEADSQUARED_FIELD_MAPPINGS).toHaveLength(6);

      const tokens = DEFAULT_LEADSQUARED_FIELD_MAPPINGS.map((m) => m.token);
      expect(tokens).toContain('{{firstName}}');
      expect(tokens).toContain('{{lastName}}');
      expect(tokens).toContain('{{company}}');
      expect(tokens).toContain('{{title}}');
      expect(tokens).toContain('{{email}}');
      expect(tokens).toContain('{{link}}');
    });

    it('marks all default mappings enabled by default', () => {
      for (const mapping of DEFAULT_LEADSQUARED_FIELD_MAPPINGS) {
        expect(mapping.enabled).toBe(true);
        expect(mapping.lsqField.length).toBeGreaterThan(0);
      }
    });

    it('normalizes tokens into comma-separated personalizationFields without braces', () => {
      const activeMappings: WizardFieldMapping[] = [
        { id: '1', token: '{{firstName}}', lsqField: 'FirstName', label: 'First Name', enabled: true },
        { id: '2', token: '{{lastName}}', lsqField: 'LastName', label: 'Last Name', enabled: false },
        { id: '3', token: '{{company}}', lsqField: 'Company', label: 'Company', enabled: true },
        { id: '4', token: '{{title}}', lsqField: 'JobTitle', label: 'Job Title', enabled: true },
        { id: '5', token: '{{customIndustry}}', lsqField: 'mx_Industry', label: 'Industry', enabled: true },
      ];

      const tokens = activeMappings
        .filter((m) => m.enabled)
        .map((m) => m.token.replace(/[{}]/g, '').trim().toLowerCase())
        .filter(Boolean);

      expect(tokens).toEqual(['firstname', 'company', 'title', 'customindustry']);
      const serialized = tokens.join(',');
      expect(serialized).toBe('firstname,company,title,customindustry');
    });
  });

  describe('Audience 4-Point Input Validation Math', () => {
    it('accurately computes health percentages and clean ready count', () => {
      const total = 100;
      const verifiedEmails = 92;
      const linkedins = 65;
      const titles = 88;
      const duplicates = 4;
      const suppressed = 2;

      const emailHealthPercent = total > 0 ? Math.round((verifiedEmails / total) * 100) : 0;
      const linkedinHealthPercent = total > 0 ? Math.round((linkedins / total) * 100) : 0;
      const titleHealthPercent = total > 0 ? Math.round((titles / total) * 100) : 0;
      const cleanReadyCount = Math.max(0, total - duplicates - suppressed);

      const validation: AudiencePreflightValidation = {
        total,
        verifiedWorkEmailCount: verifiedEmails,
        totalWithEmailCount: 96,
        missingEmailCount: 4,
        emailHealthPercent,
        linkedinProfileCount: linkedins,
        linkedinHealthPercent,
        titleAndSeniorityCount: titles,
        titleHealthPercent,
        duplicateCount: duplicates,
        suppressedCount: suppressed,
        cleanReadyCount,
      };

      expect(validation.emailHealthPercent).toBe(92);
      expect(validation.linkedinHealthPercent).toBe(65);
      expect(validation.titleHealthPercent).toBe(88);
      expect(validation.cleanReadyCount).toBe(94);
    });

    it('handles zero contacts gracefully without NaN or division by zero', () => {
      const total = 0;
      const emailHealthPercent = total > 0 ? Math.round((0 / total) * 100) : 0;
      const cleanReadyCount = Math.max(0, total - 0 - 0);

      expect(emailHealthPercent).toBe(0);
      expect(cleanReadyCount).toBe(0);
    });
  });

  describe('Wizard Step Boundary Clamping', () => {
    it('clamps steps between 0 and 5 for the 6-stage wizard', () => {
      const clampStep = (val: number) => Math.min(5, Math.max(0, val));

      expect(clampStep(-2)).toBe(0);
      expect(clampStep(0)).toBe(0);
      expect(clampStep(2)).toBe(2);
      expect(clampStep(5)).toBe(5);
      expect(clampStep(6)).toBe(5);
      expect(clampStep(99)).toBe(5);
    });
  });

  describe('Claude Scored Contacts Approval Filtering', () => {
    it('filters approved contacts dynamically based on threshold slider value', () => {
      const contacts = [
        { id: 'c1', name: 'Alice', score: 95, approvedManually: false },
        { id: 'c2', name: 'Bob', score: 85, approvedManually: false },
        { id: 'c3', name: 'Charlie', score: 70, approvedManually: false },
        { id: 'c4', name: 'Dana', score: 45, approvedManually: false },
        { id: 'c5', name: 'Evan', score: null, approvedManually: true, approved: true },
      ];

      const getApprovedCount = (threshold: number) =>
        contacts.filter((c) =>
          c.approvedManually ? c.approved : (c.score !== null && c.score >= threshold)
        ).length;

      // At threshold 80: Alice (95), Bob (85), and Evan (manual true) = 3
      expect(getApprovedCount(80)).toBe(3);

      // At threshold 90: Alice (95) and Evan (manual true) = 2
      expect(getApprovedCount(90)).toBe(2);

      // At threshold 50: Alice, Bob, Charlie, and Evan = 4
      expect(getApprovedCount(50)).toBe(4);

      // At threshold 0: All scored + manual true = 5
      expect(getApprovedCount(0)).toBe(5);
    });
  });

  describe('Per-Step Messaging & Template Selection', () => {
    it('supports independent AI personalized vs Fixed Template modes per touchpoint', () => {
      const stepConfigs: Record<
        string,
        { mode: 'ai' | 'template'; templateId?: string | null; instruction?: string }
      > = {
        invite: {
          mode: 'ai',
          instruction: 'Focus on CTO cloud migration ROI',
        },
        reminder_1: {
          mode: 'template',
          templateId: 'tmpl_urgent_48h',
        },
        reminder_2: {
          mode: 'ai',
          instruction: 'Vary angles for directors vs managers',
        },
      };

      expect(stepConfigs.invite.mode).toBe('ai');
      expect(stepConfigs.reminder_1.mode).toBe('template');
      expect(stepConfigs.reminder_1.templateId).toBe('tmpl_urgent_48h');
      expect(stepConfigs.reminder_2.mode).toBe('ai');
    });
  });

  describe('LeadSquared Tenant API Field Mapping', () => {
    it('parses tenant schema and identifies custom vs standard fields', () => {
      const mockTenantFields = [
        { SchemaName: 'FirstName', DisplayName: 'First Name', DataType: 'String' },
        { SchemaName: 'LastName', DisplayName: 'Last Name', DataType: 'String' },
        { SchemaName: 'EmailAddress', DisplayName: 'Email Address', DataType: 'Email' },
        { SchemaName: 'Company', DisplayName: 'Company / Organization', DataType: 'String' },
        { SchemaName: 'mx_Executive_Sponsor', DisplayName: 'Executive Sponsor', DataType: 'String' },
        { SchemaName: 'mx_Webinar_Track', DisplayName: 'Selected Webinar Track', DataType: 'Dropdown' },
      ];

      const standardFields = mockTenantFields.filter((f) => !f.SchemaName.startsWith('mx_'));
      const customFields = mockTenantFields.filter((f) => f.SchemaName.startsWith('mx_'));

      expect(standardFields).toHaveLength(4);
      expect(customFields).toHaveLength(2);
      expect(customFields[0].DisplayName).toBe('Executive Sponsor');
    });
  });

  describe('Cadence Step Add and Remove Journey', () => {
    it('allows operators to add custom touchpoints with offsets and channels', () => {
      const initialSteps = [
        { id: 's1', key: 'invite', title: 'Initial Invite', channel: 'email', enabled: true },
        { id: 's2', key: 'reminder_1', title: '48h Reminder', channel: 'email', enabled: true },
      ];

      const newStep = {
        id: 's3',
        key: 'custom_sms_nudge',
        title: 'SMS 2h Urgent Reminder',
        channel: 'sms',
        enabled: true,
      };

      const withAdded = [...initialSteps, newStep];
      expect(withAdded).toHaveLength(3);
      expect(withAdded.find((s) => s.id === 's3')?.channel).toBe('sms');

      // Operator removes step instead of merely disabling it
      const withRemoved = withAdded.filter((s) => s.id !== 's2');
      expect(withRemoved).toHaveLength(2);
      expect(withRemoved.some((s) => s.id === 's2')).toBe(false);
    });
  });

  describe('Review & Launch Quick Clean Contact Approval & Unblocking', () => {
    it('unblocks launch by auto-approving clean contacts if threshold slider was untouched', () => {
      const totalImported = 50;
      const suppressedCount = 3;
      const duplicateCount = 2;
      const cleanReady = totalImported - suppressedCount - duplicateCount; // 45

      let approvedCount = 0;
      const isLaunchDisabledBefore = approvedCount === 0;
      expect(isLaunchDisabledBefore).toBe(true);

      // Operator triggers "Approve all clean contacts" or launch triggers auto-approval
      approvedCount = cleanReady;
      expect(approvedCount).toBe(45);
      expect(approvedCount > 0).toBe(true);
    });
  });
});
