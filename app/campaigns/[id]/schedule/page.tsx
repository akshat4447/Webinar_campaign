import { db } from '@/lib/db';
import { ScheduleConfig } from './ScheduleConfig';
import { CadenceGroups } from './CadenceGroups';
import { LinkedInPanel } from './LinkedInPanel';
import { LaunchCadenceCard } from './LaunchCadenceCard';
import { AUTOMATED_STEP_KEYS, renderMergeFields } from '@/lib/cadence';
import { sendModeLabel } from '@/lib/sendGuard';
import { getLinkedInProgressAction } from '@/lib/actions/linkedin';
import { getServerNow } from '@/lib/actions/clock';

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, steps, approvedContacts, sendCounts, linkedinTemplate] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.cadenceStep.findMany({ where: { campaignId: id } }),
    db.contact.findMany({ where: { campaignId: id, approved: true }, take: 10 }),
    db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
    db.template.findUnique({ where: { campaignId_key: { campaignId: id, key: 'linkedin' } } }),
  ]);
  const approvedCount = await db.contact.count({ where: { campaignId: id, approved: true } });
  const linkedinProgress = await getLinkedInProgressAction(id);
  const serverNow = await getServerNow();

  // Every approved contact gets a LinkedIn touch — the profile link is a name+company
  // people-search, not a direct profile URL, so it works even without a known LinkedIn id.
  const linkedinQueue = approvedContacts.map((c) => ({
    id: c.id,
    name: c.name,
    title: c.title,
    account: c.account,
    url: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${c.name} ${c.account}`)}`,
    message: linkedinTemplate
      ? renderMergeFields(linkedinTemplate.body, { firstName: c.name.split(' ')[0] || c.name, company: c.account, topic: campaign.name, link: campaign.registrationLink ?? '' })
      : `Hi ${c.name.split(' ')[0]} — noticed ${c.account}'s work in this space. We're running ${campaign.name} and thought it'd be relevant.`,
  }));

  const countsByStep: Record<string, { sent: number; queued: number; failed: number }> = {};
  for (const row of sendCounts) {
    countsByStep[row.stepKey] ??= { sent: 0, queued: 0, failed: 0 };
    if (row.status === 'sent') countsByStep[row.stepKey].sent = row._count;
    if (row.status === 'queued') countsByStep[row.stepKey].queued = row._count;
    if (row.status === 'failed') countsByStep[row.stepKey].failed = row._count;
  }

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <ScheduleConfig campaign={campaign} />
          <CadenceGroups
            campaignId={id}
            steps={steps}
            countsByStep={countsByStep}
            automatedKeys={[...AUTOMATED_STEP_KEYS]}
            launchAtIso={(campaign.simulatedNow ?? new Date(serverNow)).toISOString()}
            webinarAtIso={campaign.scheduledAt?.toISOString() ?? null}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
          <LinkedInPanel
            campaignId={id}
            queue={linkedinQueue}
            initialProgress={linkedinProgress}
            initialMode={campaign.linkedinMode === 'automated' ? 'automated' : 'assisted'}
          />

          <div style={{ background: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-card)', padding: '16px 18px' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--n90)', marginBottom: 10 }}>Bot-led sign-up</div>
            <div style={{ fontSize: 12.5, color: 'var(--n70)', lineHeight: 1.55, marginBottom: 12 }}>
              Every send carries a pre-filled registration link — one click and the contact is registered, no form to complete.
            </div>
            <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', fontSize: 11.5, color: 'var(--n60)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {campaign.registrationLink}?c=contact-id&amp;pf=1
            </div>
          </div>

          <LaunchCadenceCard campaignId={id} approvedCount={approvedCount} cadenceStatus={campaign.cadenceStatus} sendMode={sendModeLabel()} />
        </div>
      </div>
    </main>
  );
}
