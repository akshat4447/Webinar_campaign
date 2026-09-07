'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';
import { pushAccountsForSdrAction, generatePostEventDebriefAction } from '@/lib/actions/attendance';
import type { AccountEngagementRow, PostEventStats } from '@/lib/postEvent';
import type { PostEventDebriefResult } from '@/lib/claude';

const ACTION_COLOR: Record<AccountEngagementRow['actionColor'], { bg: string; fg: string }> = {
  success: { bg: 'var(--success-100)', fg: 'var(--success-700)' },
  blue: { bg: 'var(--accent-50)', fg: 'var(--accent-700)' },
  gray: { bg: 'var(--n20)', fg: 'var(--n60)' },
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="lsq-card" style={{ padding: '14px 16px' }}>
      <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n50)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        {label}
      </div>
      <div className="lsq-num" style={{ fontSize: 'var(--fs-heading-2)', fontWeight: 700, color: 'var(--n90)', marginTop: 5 }}>
        {value}
      </div>
    </div>
  );
}

export function PostEventClient({
  campaignId,
  stats,
  approved,
  accounts,
}: {
  campaignId: string;
  stats: PostEventStats;
  approved: number;
  accounts: AccountEngagementRow[];
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [debrief, setDebrief] = useState<PostEventDebriefResult | null>(null);
  const [generatingDebrief, setGeneratingDebrief] = useState(false);

  const attendanceRate = approved > 0 ? Math.round((stats.attended / approved) * 100) : null;

  async function runDebrief() {
    setGeneratingDebrief(true);
    try {
      const res = await generatePostEventDebriefAction(campaignId);
      setDebrief(res);
      showToast('AI Executive Debrief generated.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to generate debrief.');
    } finally {
      setGeneratingDebrief(false);
    }
  }

  async function pushForSdr() {
    setBusy(true);
    try {
      const topContactIds = accounts.filter((a) => a.action !== 'Not contacted').map((a) => a.topContactId);
      const result = await pushAccountsForSdrAction(campaignId, topContactIds);
      showToast(
        result.pushed > 0
          ? `Flagged ${result.pushed} account${result.pushed === 1 ? '' : 's'} for SDR follow-up in LeadSquared.`
          : 'Nothing to push — no engaged accounts yet.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to push activities.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatTile label="Attended" value={stats.attended.toLocaleString()} />
        <StatTile label="No-shows" value={stats.noShow.toLocaleString()} />
        <StatTile label="Attendance rate" value={attendanceRate !== null ? `${attendanceRate}%` : '—'} />
        <StatTile label="Avg. watch time" value={stats.avgWatchMinutes !== null ? `${stats.avgWatchMinutes} min` : '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <div className="lsq-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>Attendee follow-up</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginBottom: 10 }}>
            {stats.attended.toLocaleString()} recipient{stats.attended === 1 ? '' : 's'} — recording link + next-step CTA
          </div>
          <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5 }}>
            Sent via LeadSquared, personalized per attendee where AI mode is on.
          </div>
        </div>
        <div className="lsq-card" style={{ padding: '18px 20px' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)', marginBottom: 4 }}>No-show follow-up</div>
          <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n50)', marginBottom: 10 }}>
            {stats.noShow.toLocaleString()} recipient{stats.noShow === 1 ? '' : 's'} — &ldquo;sorry we missed you&rdquo; + recording
          </div>
          <div style={{ background: 'var(--n10)', borderRadius: 'var(--radius-md)', padding: '12px 14px', fontSize: 'var(--fs-label-1)', color: 'var(--n70)', lineHeight: 1.5 }}>
            Sent via LeadSquared, personalized per contact where AI mode is on.
          </div>
        </div>
      </div>

      {/* Pillar 3: AI Executive Debrief & SDR Handoff */}
      <div className="lsq-card" style={{ padding: '18px 22px', marginBottom: 18, border: debrief ? '1px solid rgba(20, 99, 255, 0.3)' : '1px solid var(--border-subtle)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: debrief ? 14 : 0 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>
                ✦ AI Executive Debrief &amp; Sales Handoff
              </span>
              <Badge color="blue" text="Pillar 3 Intelligence" />
            </div>
            <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--n60)', marginTop: 2 }}>
              Claude synthesizes attendee watch time, account density, and buying signals into actionable SDR talking points.
            </div>
          </div>
          <Button size="sm" hierarchy="secondary" onClick={runDebrief} disabled={generatingDebrief}>
            {generatingDebrief ? 'Analyzing with Claude…' : debrief ? 'Regenerate Debrief' : 'Generate AI Debrief'}
          </Button>
        </div>

        {debrief && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
            {debrief.usedFallback && (
              <div style={{ fontSize: 'var(--fs-label-2)', color: 'var(--warning-700)', background: 'var(--warning-100)', borderRadius: 'var(--radius-sm)', padding: '8px 12px' }}>
                Claude wasn&apos;t reachable — this is a generic template summary, not a real analysis of this webinar&apos;s data. Regenerate once Claude is configured.
              </div>
            )}
            <div style={{ background: 'var(--accent-50)', padding: '12px 16px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(20, 99, 255, 0.2)' }}>
              <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--accent-700)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Executive Summary
              </div>
              <div style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n90)', lineHeight: 1.55 }}>
                {debrief.executiveSummary}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14 }}>
              <div style={{ background: 'var(--surface-page)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  🎯 High-Intent Accounts
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {debrief.highIntentAccounts.map((acc, i) => (
                    <Badge key={i} color="success" text={acc} />
                  ))}
                </div>
              </div>

              <div style={{ background: 'var(--surface-page)', padding: '12px 14px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                  💡 Top Interest Areas
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 'var(--fs-label-2)', color: 'var(--n80)', lineHeight: 1.5 }}>
                  {debrief.topInterestTopics.map((top, i) => (
                    <li key={i}>{top}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div style={{ background: 'var(--surface-page)', padding: '14px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 'var(--fs-label-2)', fontWeight: 700, color: 'var(--n60)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>
                📞 SDR Call Talking Points
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {debrief.sdrTalkingPoints.map((pt, i) => (
                  <div key={i} style={{ fontSize: 'var(--fs-label-1)', color: 'var(--n80)', display: 'flex', gap: 8 }}>
                    <span style={{ color: 'var(--accent-500)', fontWeight: 700 }}>{i + 1}.</span>
                    <span>{pt}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="lsq-card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '16px 20px', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ fontSize: 'var(--fs-label-1)', fontWeight: 700, color: 'var(--n90)' }}>Account engagement summary</div>
          <Button size="sm" onClick={pushForSdr} disabled={busy || accounts.length === 0}>
            {busy ? 'Pushing…' : 'Push to LSQ for SDR'}
          </Button>
        </div>
        {accounts.length === 0 ? (
          <div style={{ padding: '24px 20px', fontSize: 'var(--fs-label-1)', color: 'var(--n60)', textAlign: 'center' }}>
            No approved contacts yet.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="lsq-table" style={{ width: '100%', minWidth: 640, fontSize: 'var(--fs-label-1)' }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '10px 20px' }}>Account</th>
                  <th className="num" style={{ padding: '10px 20px' }}>Contacts</th>
                  <th className="num" style={{ padding: '10px 20px' }}>Attended</th>
                  <th className="num" style={{ padding: '10px 20px' }}>Avg. watch</th>
                  <th style={{ padding: '10px 20px' }}>Intent Tier</th>
                  <th style={{ padding: '10px 20px' }}>Next step</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const color = ACTION_COLOR[a.actionColor];
                  return (
                    <tr key={a.account}>
                      <td style={{ padding: '12px 20px', fontWeight: 600 }}>{a.account}</td>
                      <td className="num" style={{ padding: '12px 20px' }}>{a.contactCount}</td>
                      <td className="num" style={{ padding: '12px 20px' }}>{a.attended}</td>
                      <td className="num" style={{ padding: '12px 20px' }}>{a.avgWatchMinutes !== null ? `${a.avgWatchMinutes} min` : '—'}</td>
                      <td style={{ padding: '12px 20px' }}>
                        <Badge
                          color={a.intentTier === 'high' ? 'success' : a.intentTier === 'medium' ? 'blue' : 'gray'}
                          text={a.intentTier === 'high' ? 'High Intent' : a.intentTier === 'medium' ? 'Engaged' : 'Cold'}
                        />
                      </td>
                      <td style={{ padding: '12px 20px' }}>
                        <span
                          style={{
                            fontSize: 'var(--fs-label-2)',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-full)',
                            padding: '3px 10px',
                            background: color.bg,
                            color: color.fg,
                          }}
                        >
                          {a.action}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
