import { getOverviewData } from '@/lib/overviewData';
import { db } from '@/lib/db';
import { resolveStepTemplates } from '@/lib/messageTemplates';
import { getAttendeeChannelBreakdown } from '@/lib/attendeeChannels';
import { formatSpeakersSummary } from '@/lib/speakers';
import { getServerNow } from '@/lib/actions/clock';
import { ATTENDANCE_RATE_LABEL, ATTENDANCE_RATE_SUBLABEL, formatAttendanceRate } from '@/lib/attendanceRate';
import { getCampaignRegistrationChannels } from '@/lib/registrationChannelsServer';
import { appOrigin } from '@/lib/appOrigin';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';
import { DashboardClient } from './DashboardClient';
import { HistoricalSummary } from './HistoricalSummary';

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ edit?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const initialEditOpen = resolvedSearchParams.edit === '1' || resolvedSearchParams.edit === 'true';

  const [campaign, data, sendCounts, steps, serverNow, registrationChannels, openIssues] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id }, include: { speakers: { orderBy: { order: 'asc' } } } }),
    getOverviewData(id),
    db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
    db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null }, select: { key: true } }),
    getServerNow(),
    getCampaignRegistrationChannels(id, appOrigin()),
    db.attentionItem.findMany({ where: { campaignId: id, resolvedAt: null, color: 'error' }, select: { title: true } }),
  ]);

  const hasHistorical =
    campaign.invites != null || campaign.registrations != null || campaign.attendance != null || campaign.demoRequests != null;
  const isHistoricalCompleted = isCampaignCompleted(campaign.status) && data.counts.total === 0 && hasHistorical;

  if (isHistoricalCompleted) {
    const historicalDrawers: Record<string, { title: string; subtitle: string; columns: string[]; rows: string[][]; notes?: string[] }> = {};
    for (const ch of registrationChannels.channels) {
      historicalDrawers[`Channel: ${ch.label}`] = {
        title: `${ch.label} Registrants`,
        subtitle: `${ch.registeredCount} contacts registered via ${ch.label} (${ch.pctOfTotal}% of total registrations)`,
        columns: ['Contact', 'Account', 'Title', 'Score'],
        rows: ch.contacts
          .slice()
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 50)
          .map((c) => [c.name, c.account || '—', c.title || '—', c.score !== null ? String(c.score) : '—']),
        notes: ch.trackingUrl ? [`Channel Tracking URL: ${ch.trackingUrl}`] : undefined,
      };
    }

    return (
      <main className="lsq-ov-main">
        <HistoricalSummary
          campaign={campaign}
          serverNow={serverNow}
          initialEditOpen={initialEditOpen}
          registrationChannels={registrationChannels}
          drawers={historicalDrawers}
        />
      </main>
    );
  }

  const sentByStep: Record<string, number> = {};
  const failedByStep: Record<string, number> = {};
  const queuedByStep: Record<string, number> = {};
  for (const row of sendCounts) {
    if (row.status === 'sent') sentByStep[row.stepKey] = (sentByStep[row.stepKey] ?? 0) + row._count;
    if (row.status === 'failed') failedByStep[row.stepKey] = (failedByStep[row.stepKey] ?? 0) + row._count;
    if (row.status === 'queued') queuedByStep[row.stepKey] = (queuedByStep[row.stepKey] ?? 0) + row._count;
  }
  const totalDelivered = Object.values(sentByStep).reduce((a, b) => a + b, 0);

  const {total,enriched,scored,approved,invited,registered,attended,synced}=data.counts;
  const crmSyncFailing = openIssues.some((i) => /leadsquared.*(sync|push)/i.test(i.title));
  const hasOpenSendErrors = openIssues.length > 0;
  const attendanceImported = !!campaign.attendanceImportedAt;
  const zoomLinked = !!campaign.zoomMeetingId;
  const attendeeChannelBreakdown = attendanceImported ? await getAttendeeChannelBreakdown(id) : [];

  // Strictly sequential stages only — each one is a subset of the one above, so a
  // stage-to-stage percentage is meaningful. CRM sync is deliberately excluded: it
  // happens on import, not after attendance, so ratioing it against the previous
  // stage produces nonsense like "200%". It lives in the KPI row instead.
  const rawFunnel = [
    { label: 'Imported', value: total },
    { label: 'Enriched', value: enriched },
    { label: 'Scored', value: scored },
    { label: 'Approved', value: approved },
    { label: 'Invited (invite step)', value: invited },
    { label: 'Registered', value: registered },
    ...(attendanceImported ? [{ label: 'Attended', value: attended }] : []),
  ];
  const funnel = rawFunnel.map((stage, i) => {
    const prev = i === 0 ? null : rawFunnel[i - 1].value;
    // A stage bigger than its predecessor means the two aren't actually derived
    // from each other (e.g. attendance imported from Zoom while sends failed) —
    // showing >100% would imply a conversion that didn't happen.
    const ratio = prev === null || prev === 0 ? null : Math.round((stage.value / prev) * 100);
    return {
      ...stage,
      pctOfTotal: total ? Math.round((stage.value / total) * 100) : 0,
      stepConversion: ratio !== null && ratio > 100 ? null : ratio,
    };
  });

  const kpis = [
    { label: 'Approval rate', value: total ? `${Math.round((approved / total) * 100)}%` : '—', sub: `${approved.toLocaleString()} of ${total.toLocaleString()} imported contacts`, tone: 'accent' as const },
    { label: 'Invites delivered', value: invited.toLocaleString(), sub: failedByStep['invite'] ? `${failedByStep['invite']} failed` : 'no failures', tone: failedByStep['invite'] ? ('warn' as const) : ('neutral' as const) },
    { label: 'Messages sent', value: totalDelivered.toLocaleString(), sub: 'every channel and step', tone: 'neutral' as const },
    {
      label: ATTENDANCE_RATE_LABEL,
      // Single shared definition (lib/attendanceRate.ts): attended / registered,
      // null when that would exceed 100% — attended isn't strictly derived from
      // registered (e.g. a Zoom email match for someone who never completed
      // registration), so it can exceed the denominator.
      value: attendanceImported ? formatAttendanceRate(attended, registered) : '—',
      sub: attendanceImported
        ? `${attended} of ${registered} ${ATTENDANCE_RATE_SUBLABEL.replace('of ', '')}`
        : zoomLinked
          ? 'pulls in automatically post-webinar'
          : 'link a Zoom meeting in webinar setup',
      tone: 'neutral' as const,
    },
    {
      label: 'CRM synced',
      value: total ? `${Math.round((synced / total) * 100)}%` : '—',
      // A card that says "good" while the sync is failing is exactly what the audit caught (L-13).
      sub: crmSyncFailing ? `${synced.toLocaleString()} leads written back · sync failing, see Results` : `${synced.toLocaleString()} leads written back`,
      tone: crmSyncFailing ? ('warn' as const) : ('good' as const),
    },
  ];

  const {scoreBands,breakdownData,accountBreakdown,drawers}=data;

  // Derived, never hardcoded: the old fixed list silently omitted sms, t3, t1d
  // and t1h, so real sends rendered nowhere. Union the campaign's own steps
  // and anything that has actually been sent, so a newly added channel can
  // never go missing again.
  const stepOrder = [...new Set([...steps.map((s) => s.key), ...Object.keys(sentByStep), ...Object.keys(failedByStep), ...Object.keys(queuedByStep)])];

  // Label/channel come from resolveStepTemplate — the same source-of-truth
  // chain the send path uses — rather than the legacy per-campaign Template
  // table, which is empty for every campaign provisioned since the shared
  // library replaced it.
  const resolvedSteps = await resolveStepTemplates(id, stepOrder);
  const stepMeta = new Map(stepOrder.map((key) => {
    const t = resolvedSteps.get(key);
    return [key, t ? { label: t.label, channel: t.channel } : undefined];
  }));

  const maxSent = Math.max(1, ...stepOrder.map((k) => sentByStep[k] ?? 0));
  const stepBreakdown = stepOrder
    .filter((k) => (sentByStep[k] ?? 0) > 0 || (failedByStep[k] ?? 0) > 0)
    .map((k) => ({
      label: stepMeta.get(k)?.label ?? k,
      count: sentByStep[k] ?? 0,
      failed: failedByStep[k] ?? 0,
      pct: Math.round(((sentByStep[k] ?? 0) / maxSent) * 100),
    }));

  // Channel rollup — the funnel is invite-only by design, so this is where the
  // full multi-channel picture lives.
  const channelTotals = new Map<string, { sent: number; queued: number; failed: number }>();
  for (const k of stepOrder) {
    const channel = stepMeta.get(k)?.channel ?? 'Other';
    const acc = channelTotals.get(channel) ?? { sent: 0, queued: 0, failed: 0 };
    acc.sent += sentByStep[k] ?? 0;
    acc.queued += queuedByStep[k] ?? 0;
    acc.failed += failedByStep[k] ?? 0;
    channelTotals.set(channel, acc);
  }
  const channelBreakdown = [...channelTotals.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .filter((c) => c.sent > 0 || c.queued > 0 || c.failed > 0)
    .sort((a, b) => b.sent - a.sent);

  // Add channel drawers so clicking a channel card opens the list of contacts registered through it
  for (const ch of registrationChannels.channels) {
    drawers[`Channel: ${ch.label}`] = {
      title: `${ch.label} Registrants`,
      subtitle: `${ch.registeredCount} contacts registered via ${ch.label} (${ch.pctOfTotal}% of total registrations)`,
      columns: ['Contact', 'Account', 'Title', 'Score'],
      rows: ch.contacts
        .slice()
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 50)
        .map((c) => [c.name, c.account || '—', c.title || '—', c.score !== null ? String(c.score) : '—']),
      notes: ch.trackingUrl ? [`Channel Tracking URL: ${ch.trackingUrl}`] : undefined,
    };
  }

  // Seven pipeline stages, always the same seven regardless of what's been
  // imported yet — a tile reading 0 is still informative ("nothing invited
  // yet"), whereas dropping it would look like the stage doesn't exist.
  const pipeline = (['Imported', 'Enriched', 'Scored', 'Approved', 'Invited', 'Registered', 'Attended'] as const).map((label) => ({
    label,
    value: data.stageCounts[label],
    pctOfTotal: total ? Math.round((data.stageCounts[label] / total) * 100) : 0,
  }));

  const about = {
    name: campaign.name,
    vertical: campaign.vertical,
    date: campaign.date,
    description: campaign.description,
    speakerName: campaign.speakerName,
    speakerTitle: campaign.speakerTitle,
    capacity: campaign.capacity,
    speakersSummary: campaign.speakers?.length ? formatSpeakersSummary(campaign.speakers) : null,
  };

  // "What the agent learned" — honest, computed observations about this one
  // campaign, not a generated narrative. Each line only appears if there's
  // enough data behind it; a quiet campaign gets no fabricated insight.
  const learnings: string[] = [];
  const overallRate=scored?Math.round(data.counts.approvedScored/scored*100):null;
  for(const group of data.learningGroups){
    if(overallRate!==null && group.rate>overallRate)learnings.push(`${group.label} has the highest approval rate by ${group.kind}: ${group.rate}% approved (${group.total} scored) vs. ${overallRate}% overall.`);
  }

  if (scoreBands.length >= 2) {
    const top = scoreBands[0];
    const bottom = scoreBands[scoreBands.length - 1];
    if (top.approvalRate !== null && bottom.approvalRate !== null) {
      learnings.push(
        top.approvalRate > bottom.approvalRate
          ? `Approval is higher in the top score band: the ${top.label} band approves at ${top.approvalRate}% vs. ${bottom.approvalRate}% for ${bottom.label}.`
          : `Approval is similar across these score bands: the ${top.label} band (${top.approvalRate}%) isn't outperforming ${bottom.label} (${bottom.approvalRate}%).`
      );
    }
  }

  const failedChannel = channelBreakdown.filter((c) => c.failed > 0).sort((a, b) => b.failed - a.failed)[0];
  if (failedChannel) {
    learnings.push(`${failedChannel.label} has the most delivery failures so far (${failedChannel.failed}) — worth a look in Control Center.`);
  } else if (totalDelivered > 0 && !hasOpenSendErrors) {
    learnings.push(`Every send has gone through clean so far — ${totalDelivered} sent, zero failures.`);
  } else if (totalDelivered > 0) {
    learnings.push(`${totalDelivered} sent, but ${openIssues.length} open ${openIssues.length === 1 ? 'issue needs' : 'issues need'} review in Results.`);
  }

  return (
    <main className="lsq-ov-main">
      <DashboardClient
        pipeline={pipeline}
        about={about}
        learnings={learnings}
        kpis={kpis}
        funnel={funnel}
        scoreBands={scoreBands}
        stepBreakdown={stepBreakdown}
        channelBreakdown={channelBreakdown}
        breakdownData={breakdownData}
        accountBreakdown={accountBreakdown}
        attended={attended}
        approved={approved}
        attendanceImported={attendanceImported}
        zoomLinked={zoomLinked}
        attendeeChannelBreakdown={attendeeChannelBreakdown}
        drawers={drawers}
        campaign={campaign}
        serverNow={serverNow}
        initialEditOpen={initialEditOpen}
        registrationChannels={registrationChannels}
      />
    </main>
  );
}
