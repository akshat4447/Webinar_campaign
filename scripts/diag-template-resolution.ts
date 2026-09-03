// Shows which message every cadence step would actually send, and where that
// copy came from.
//
// Resolution has four layers (step -> campaign override -> shared library ->
// legacy per-campaign row), so "the wrong text went out" is otherwise hard to
// trace. An UNRESOLVED step is a step that would fail every send with
// "Missing template", which is the failure this exists to catch early.
//
//   npx tsx scripts/diag-template-resolution.ts            # every campaign
//   npx tsx scripts/diag-template-resolution.ts <id>       # one campaign

import { db } from '@/lib/db';
import { resolveStepTemplate } from '@/lib/messageTemplates';

(async () => {
  const only = process.argv[2];
  const campaigns = await db.campaign.findMany({
    where: only ? { id: only } : {},
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
  });

  let unresolved = 0;
  for (const c of campaigns) {
    const steps = await db.cadenceStep.findMany({ where: { campaignId: c.id, removedAt: null }, orderBy: { key: 'asc' } });
    const rows: string[] = [];
    for (const s of steps) {
      const t = await resolveStepTemplate(c.id, s.key);
      if (!t) {
        unresolved++;
        rows.push(`   ${s.key.padEnd(12)} UNRESOLVED — every send of this step will fail`);
        continue;
      }
      const flags = [t.hidden ? 'hidden' : null, t.status !== 'ready' ? t.status : null].filter(Boolean).join(',');
      rows.push(`   ${s.key.padEnd(12)} ${t.source.padEnd(17)} ${t.channel.padEnd(9)} ${flags}`);
    }
    console.log(`${c.name.slice(0, 60)}  (${c.id})`);
    console.log(rows.join('\n'));
    console.log('');
  }

  console.log(`campaigns: ${campaigns.length} · unresolved steps: ${unresolved}`);
  process.exit(unresolved === 0 ? 0 : 1);
})();
