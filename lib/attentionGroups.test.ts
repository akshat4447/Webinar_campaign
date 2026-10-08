import { describe, it, expect } from 'vitest';
import { groupAttentionItems } from './attentionGroups';
import { clipDetail } from './attentionItems';

const item = (id: string, title: string, detail = 'Mailbox not verified', color = 'error', actionsCsv = 'retry') => ({ id, icon: 'x', color, title, detail, actionsCsv });

describe('groupAttentionItems', () => {
  it('collapses the same failure across contacts into one card', () => {
    const g = groupAttentionItems([item('1', 'Send failed for Asha Rao'), item('2', 'Send failed for Ben Cole'), item('3', 'Send failed for Chen Wu')]);
    expect(g).toHaveLength(1);
    expect(g[0].items).toHaveLength(3);
    expect(g[0].title).toBe('Send failed for 3 contacts');
  });
  it('keeps the shared ending of the title', () => {
    const g = groupAttentionItems([item('1', 'Personalized copy for Asha skipped — sent the template instead', 'd', 'warning', 'view'), item('2', 'Personalized copy for Ben skipped — sent the template instead', 'd', 'warning', 'view')]);
    expect(g[0].title).toBe('Personalized copy for 2 contacts skipped — sent the template instead');
  });
  it('does not merge different problems', () => {
    const g = groupAttentionItems([item('1', 'Send failed for A', 'Mailbox not verified'), item('2', 'Send failed for B', 'Rate limited')]);
    expect(g).toHaveLength(2);
  });
  it('does not merge different severities or actions', () => {
    expect(groupAttentionItems([item('1', 'A'), item('2', 'B', 'Mailbox not verified', 'warning')])).toHaveLength(2);
    expect(groupAttentionItems([item('1', 'A'), item('2', 'B', 'Mailbox not verified', 'error', 'view')])).toHaveLength(2);
  });
  it('leaves a single item untouched', () => {
    expect(groupAttentionItems([item('1', 'Only one')])[0].title).toBe('Only one');
  });
});

describe('clipDetail', () => {
  it('keeps short text as is', () => expect(clipDetail('short')).toBe('short'));
  it('clips at a word boundary with an ellipsis, never mid-word', () => {
    const long = 'The sender must have a verified sending domain configured. '.repeat(20);
    const out = clipDetail(long, 100);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(/\s(domain|configured\.?|verified|sending|a|The|must|have)$/.test(out.slice(0, -1))).toBe(true);
  });
});
