'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { useToast } from '@/components/ui/Toast';
import { pushAccountsForSdrAction, generatePostEventDebriefAction } from '@/lib/actions/attendance';
import type { AccountEngagementRow, PostEventStats } from '@/lib/postEvent';
import type { PostEventDebriefResult } from '@/lib/claude';
import { ATTENDANCE_RATE_LABEL, formatAttendanceRate } from '@/lib/attendanceRate';

const ACTION_COLOR: Record<AccountEngagementRow['actionColor'], string> = {
  success: 'success',
  blue: 'blue',
  gray: 'gray',
};

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="lsq-card lsq-stat">
      <p className="lsq-stat__label">{label}</p>
      <p className="lsq-stat__value">{value}</p>
    </div>
  );
}

export function PostEventClient({
  campaignId,
  stats,
  accounts,
}: {
  campaignId: string;
  stats: PostEventStats;
  accounts: AccountEngagementRow[];
}) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  const [debrief, setDebrief] = useState<PostEventDebriefResult | null>(null);
  const [generatingDebrief, setGeneratingDebrief] = useState(false);

  // Shared definition (lib/attendanceRate.ts) — attended / registered. This
  // tile used to divide by `approved`, so the same campaign showed one
  // attendance rate here and a different one on the dashboard and Overview.

  async function runDebrief() {
    setGeneratingDebrief(true);
    try {
      const res = await generatePostEventDebriefAction(campaignId);
      setDebrief(res);
      showToast('AI executive debrief generated.');
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
          : 'Nothing to push. No engaged accounts yet.'
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to push activities.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="lsq-grid lsq-grid--narrow">
        <StatTile label="Attended" value={stats.attended.toLocaleString()} />
        <StatTile label="No-shows" value={stats.noShow.toLocaleString()} />
        <StatTile
          label={ATTENDANCE_RATE_LABEL}
          value={formatAttendanceRate(stats.attended, stats.registered)}
        />
        <StatTile label="Avg. watch time" value={stats.avgWatchMinutes !== null ? `${stats.avgWatchMinutes} min` : '\u2014'} />
      </div>

      <div className="lsq-grid lsq-grid--wide">
        <section className="lsq-card" aria-labelledby="pe-attended">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="pe-attended">Attendee Follow-Up</h2>
              <p className="lsq-card__sub">
                {stats.attended.toLocaleString()} recipient{stats.attended === 1 ? '' : 's'}: recording link and next-step CTA
              </p>
            </div>
          </div>
          <div className="lsq-card__body">
            <div className="lsq-msgbox">Sent via LeadSquared, personalized per attendee where AI mode is on.</div>
          </div>
        </section>
        <section className="lsq-card" aria-labelledby="pe-noshow">
          <div className="lsq-card__header">
            <div>
              <h2 className="lsq-card__title" id="pe-noshow">No-Show Follow-Up</h2>
              <p className="lsq-card__sub">
                {stats.noShow.toLocaleString()} recipient{stats.noShow === 1 ? '' : 's'}: &ldquo;sorry we missed you&rdquo; and recording
              </p>
            </div>
          </div>
          <div className="lsq-card__body">
            <div className="lsq-msgbox">Sent via LeadSquared, personalized per contact where AI mode is on.</div>
          </div>
        </section>
      </div>

      {/* Pillar 3: AI Executive Debrief & SDR Handoff */}
      <section className="lsq-card" aria-labelledby="pe-debrief">
        <div className={`lsq-card__header${debrief ? '' : ' lsq-res-headonly'}`}>
          <div>
            <h2 className="lsq-card__title" id="pe-debrief">AI Executive Debrief &amp; Sales Handoff</h2>
            <p className="lsq-card__sub">
              Claude synthesizes attendee watch time, account density and buying signals into actionable SDR talking points.
            </p>
          </div>
          <Button size="sm" hierarchy="secondary" icon={<Icon name="sparkle" size={14} />} onClick={runDebrief} loading={generatingDebrief}>
            {generatingDebrief ? 'Analyzing with Claude' : debrief ? 'Regenerate Debrief' : 'Generate AI Debrief'}
          </Button>
        </div>

        {debrief && (
          <div className="lsq-card__body lsq-stack">
            {debrief.usedFallback && (
              <div className="lsq-banner lsq-banner--warning" role="status">
                <span className="lsq-banner__icon"><Icon name="warning" size={16} /></span>
                <p className="lsq-banner__body">
                  Claude was not reachable. This is a generic template summary, not a real analysis of this webinar&apos;s data. Regenerate once Claude is configured.
                </p>
              </div>
            )}
            <div className="lsq-banner">
              <div>
                <p className="lsq-banner__title">Executive Summary</p>
                <p className="lsq-banner__body">{debrief.executiveSummary}</p>
              </div>
            </div>

            <div className="lsq-grid lsq-grid--wide">
              <div className="lsq-res-panel">
                <h3 className="lsq-res-panel__title">High-Intent Accounts</h3>
                <div className="lsq-chips">
                  {debrief.highIntentAccounts.map((acc, i) => (
                    <Badge key={i} color="success" text={acc} />
                  ))}
                </div>
              </div>

              <div className="lsq-res-panel">
                <h3 className="lsq-res-panel__title">Top Interest Areas</h3>
                <ul className="lsq-res-list">
                  {debrief.topInterestTopics.map((top, i) => (
                    <li key={i}>{top}</li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="lsq-res-panel">
              <h3 className="lsq-res-panel__title">SDR Call Talking Points</h3>
              <ol className="lsq-res-list lsq-res-list--numbered">
                {debrief.sdrTalkingPoints.map((pt, i) => (
                  <li key={i}>{pt}</li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </section>

      <section className="lsq-card" aria-labelledby="pe-accounts">
        <div className="lsq-card__header">
          <h2 className="lsq-card__title" id="pe-accounts">Account Engagement Summary</h2>
          <Button size="sm" icon={<Icon name="share" size={14} />} onClick={pushForSdr} loading={busy} disabled={accounts.length === 0}>
            {busy ? 'Pushing' : 'Push to LSQ for SDR'}
          </Button>
        </div>
        {accounts.length === 0 ? (
          <div className="lsq-empty">
            <p className="lsq-empty__body">No approved contacts yet.</p>
          </div>
        ) : (
          <div className="lsq-table-wrap" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="lsq-table lsq-res-table">
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className="lsq-res-num">Contacts</th>
                  <th scope="col" className="lsq-res-num">Attended</th>
                  <th scope="col" className="lsq-res-num">Avg. watch</th>
                  <th scope="col">Intent tier</th>
                  <th scope="col">Next step</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => (
                  <tr key={a.account}>
                    <td className="lsq-cell-primary">{a.account}</td>
                    <td className="lsq-res-num">{a.contactCount.toLocaleString()}</td>
                    <td className="lsq-res-num">{a.attended.toLocaleString()}</td>
                    <td className="lsq-res-num">{a.avgWatchMinutes !== null ? `${a.avgWatchMinutes} min` : '\u2014'}</td>
                    <td>
                      <Badge
                        color={a.intentTier === 'high' ? 'success' : a.intentTier === 'medium' ? 'blue' : 'gray'}
                        text={a.intentTier === 'high' ? 'High intent' : a.intentTier === 'medium' ? 'Engaged' : 'Cold'}
                      />
                    </td>
                    <td>
                      <Badge color={ACTION_COLOR[a.actionColor]} text={a.action} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
