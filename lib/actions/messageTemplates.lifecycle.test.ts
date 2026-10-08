import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db', () => ({
  db: {
    messageTemplate: { findUniqueOrThrow: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { db } from '@/lib/db';
import { createMessageTemplateAction, saveMessageTemplateAction } from './messageTemplates';

const m = db.messageTemplate as unknown as {
  findUniqueOrThrow: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  m.create.mockResolvedValue({ id: 'new' });
});

describe('new email template lifecycle', () => {
  it('is created as an unpublished draft, not ready', async () => {
    await createMessageTemplateAction('email');
    expect(m.create.mock.calls[0][0].data.status).toBe('draft');
  });

  it('is promoted to ready on the first save that has a subject and body', async () => {
    m.findUniqueOrThrow.mockResolvedValue({ channel: 'email', status: 'draft', subject: '', body: '' });
    await saveMessageTemplateAction('t', { subject: 'Hello', body: 'World' });
    expect(m.update.mock.calls[0][0].data.status).toBe('ready');
  });

  it('stays a draft while the body is still empty', async () => {
    m.findUniqueOrThrow.mockResolvedValue({ channel: 'email', status: 'draft', subject: '', body: '' });
    await saveMessageTemplateAction('t', { subject: 'Hello' });
    expect(m.update.mock.calls[0][0].data.status).toBeUndefined();
  });

  it('does not touch the status of non-email or already-ready templates', async () => {
    m.findUniqueOrThrow.mockResolvedValue({ channel: 'whatsapp', status: 'draft', subject: null, body: 'x' });
    await saveMessageTemplateAction('t', { body: 'y' });
    expect(m.update.mock.calls[0][0].data.status).toBeUndefined();
  });
});
