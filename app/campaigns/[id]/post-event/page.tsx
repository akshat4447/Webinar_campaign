import { db } from '@/lib/db';
import { getAccountEngagement, getPostEventStats } from '@/lib/postEvent';
import { ZoomPanel } from '../agent/ZoomPanel';
import { PostEventClient } from './PostEventClient';

// Attendance import lives here rather than on the Agent run tab: importing a
// participants report is a post-event act, and the operator looking for it is
// thinking about results, not about the running cadence.
export default async function PostEventPage(props: PageProps<'/campaigns/[id]/post-event'>) {
  const { id } = await props.params;
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });
  const hasLinkedMeeting = !!campaign.zoomMeetingId;

  const [stats, accounts, approvedCount] = await Promise.all([
    getPostEventStats(id),
    getAccountEngagement(id),
    db.contact.count({ where: { campaignId: id, approved: true } }),
  ]);

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 320px)', gap: 20, alignItems: 'start' }}>
        <div>
          <PostEventClient campaignId={id} stats={stats} approved={approvedCount} accounts={accounts} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <ZoomPanel campaignId={id} hasLinkedMeeting={hasLinkedMeeting} />
          {campaign.attendanceImportedAt && (
            <div className="lsq-card" style={{ padding: '16px 18px' }}>
              <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 'var(--fw-bold)', color: 'var(--n90)', marginBottom: 6 }}>
                Attendance imported
              </div>
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n60)', lineHeight: 1.55 }}>
                {campaign.attendanceImportedAt.toLocaleString('en-GB')} — attendee and no-show follow-ups were queued
                from this import.
              </div>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
