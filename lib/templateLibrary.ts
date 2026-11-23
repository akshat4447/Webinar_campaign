// The shared message-template library (MessageTemplate rows with no campaign). New webinars and steps the operator
// adds take their starting message from it, so a database that never ran the demo seed (a fresh deployment) would
// otherwise leave an added step with no template and launch blocked. Fills in only the library entries that are
// missing and never changes one that exists, so an operator's edits to the library survive.
import { db } from '@/lib/db';
import { templatesData } from '@/lib/demo-data';

export function libraryChannel(channel: string): 'email' | 'sms' | 'whatsapp' | 'linkedin' {
  const ch = channel.toLowerCase();
  return ch.includes('whatsapp') ? 'whatsapp' : ch.includes('sms') ? 'sms' : ch.includes('linkedin') ? 'linkedin' : 'email';
}

export async function ensureTemplateLibrary(): Promise<number> {
  const existing = await db.messageTemplate.findMany({ where: { campaignId: null }, select: { key: true } });
  const have = new Set(existing.map((t) => t.key));
  const missing = templatesData.filter((t) => !have.has(t.id));
  if (missing.length === 0) return 0;
  const { count } = await db.messageTemplate.createMany({
    data: missing.map((t) => {
      const channel = libraryChannel(t.channel);
      return {
        campaignId: null,
        key: t.id,
        name: t.label,
        channel,
        hasSubject: t.hasSubject,
        subject: t.subject,
        body: t.body,
        status: channel === 'linkedin' ? 'assisted' : 'ready',
      };
    }),
    skipDuplicates: true,
  });
  return count;
}
