import { db } from '@/lib/db';
import { DashboardClient } from './DashboardClient';
import { HistoricalSummary } from './HistoricalSummary';

const SCORE_BANDS = [
  { label: '90–100', min: 90, max: 101 },
  { label: '75–89', min: 75, max: 90 },
  { label: '60–74', min: 60, max: 75 },
  { label: 'Below 60', min: -1, max: 60 },
];

export default async function DashboardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [campaign, contacts, sendCounts, invitedSends, templates, steps] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.contact.findMany({ where: { campaignId: id } }),
    db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
    db.cadenceSend.findMany({ where: { campaignId: id, stepKey: 'invite', status: 'sent' }, select: { contactId: true } }),
    // Template carries both the human label and the real channel, so the
    // dashboard no longer needs its own hardcoded copy of either.
    db.template.findMany({ where: { campaignId: id }, select: { key: true, label: true, channel: true } }),
    db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null }, select: { key: true } }),
  ]);

  if (contacts.length === 0) {
    return (
      <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
        <HistoricalSummary campaign={campaign} />
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

  const total = contacts.length;
  const enriched = contacts.filter((c) => c.enrichedAt).length;
  const scored = contacts.filter((c) => c.score !== null).length;
  const approved = contacts.filter((c) => c.approved).length;
  const invitedIds = new Set(invitedSends.map((s) => s.contactId));
  const invited = invitedIds.size;
  const attended = contacts.filter((c) => c.attended).length;
  const synced = contacts.filter((c) => c.lsqLeadId).length;
  const attendanceImported = !!campaign.attendanceImportedAt;

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
    { label: 'Approval rate', value: total ? `${Math.round((approved / total) * 100)}%` : '—', sub: `${approved} of ${total} scored contacts`, tone: 'accent' as const },
    { label: 'Invites delivered', value: String(invited), sub: failedByStep['invite'] ? `${failedByStep['invite']} failed` : 'no failures', tone: failedByStep['invite'] ? ('warn' as const) : ('neutral' as const) },
    { label: 'Messages delivered', value: String(totalDelivered), sub: 'every channel and step', tone: 'neutral' as const },
    {
      label: 'Attendance rate',
      value: attendanceImported && approved ? `${Math.round((attended / approved) * 100)}%` : '—',
      sub: attendanceImported ? `${attended} of ${approved} approved` : 'import a Zoom report',
      tone: 'neutral' as const,
    },
    { label: 'CRM synced', value: total ? `${Math.round((synced / total) * 100)}%` : '—', sub: `${synced} leads written back`, tone: 'good' as const },
  ];

  // The advanced read: does the AI's score actually predict the outcome?
  const scoreBands = SCORE_BANDS.map((band) => {
    const inBand = contacts.filter((c) => c.score !== null && c.score >= band.min && c.score < band.max);
    const bandApproved = inBand.filter((c) => c.approved).length;
    const bandAttended = inBand.filter((c) => c.attended).length;
    return {
      label: band.label,
      contacts: inBand.length,
      approved: bandApproved,
      attended: bandAttended,
      approvalRate: inBand.length ? Math.round((bandApproved / inBand.length) * 100) : null,
      attendanceRate: bandApproved ? Math.round((bandAttended / bandApproved) * 100) : null,
    };
  }).filter((b) => b.contacts > 0);

  // Derived, never hardcoded: the old fixed list silently omitted sms, t3, t1d
  // and t1h, so real sends rendered nowhere. Union the campaign's own steps,
  // its templates, and anything that has actually been sent, so a newly added
  // channel can never go missing again.
  const stepMeta = new Map(templates.map((t) => [t.key, { label: t.label, channel: t.channel }]));
  const stepOrder = [...new Set([...steps.map((s) => s.key), ...templates.map((t) => t.key), ...Object.keys(sentByStep), ...Object.keys(failedByStep), ...Object.keys(queuedByStep)])];

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

  function groupBy(key: (c: (typeof contacts)[number]) => string) {
    const counts = new Map<string, number>();
    for (const c of contacts) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
    const max = Math.max(1, ...counts.values());
    return [...counts.entries()].map(([label, count]) => ({ label, count, pct: Math.round((count / max) * 100) })).sort((a, b) => b.count - a.count);
  }

  const breakdownData = {
    persona: groupBy((c) => `${c.seniority} · ${c.function}`),
    scoreband: groupBy((c) => {
      const s = c.score ?? 0;
      if (s >= 90) return '90–100 (Excellent)';
      if (s >= 75) return '75–89 (Strong)';
      if (s >= 60) return '60–74 (Moderate)';
      return 'Below 60 (Low)';
    }),
    source: groupBy((c) => c.source),
    vertical: groupBy((c) => c.vertical),
  };

  const byAccount = new Map<string, typeof contacts>();
  for (const c of contacts) byAccount.set(c.account, [...(byAccount.get(c.account) ?? []), c]);
  const accountBreakdown = [...byAccount.entries()]
    .map(([account, cs]) => {
      const accApproved = cs.filter((c) => c.approved).length;
      const accAttended = cs.filter((c) => c.attended).length;
      const topScore = Math.max(0, ...cs.map((c) => c.score ?? 0));
      const action = accAttended > 0 ? 'Attended' : accApproved > 0 ? 'Approved' : 'Not contacted';
      const actionColor = accAttended > 0 ? 'success' : accApproved > 0 ? 'blue' : 'gray';
      return { account, contactCount: cs.length, approved: accApproved, attended: accAttended, topScore, action, actionColor };
    })
    .sort((a, b) => b.topScore - a.topScore || b.contactCount - a.contactCount)
    .slice(0, 12);

  const stageContacts: Record<string, typeof contacts> = {
    Imported: contacts,
    Enriched: contacts.filter((c) => c.enrichedAt),
    Scored: contacts.filter((c) => c.score !== null),
    Approved: contacts.filter((c) => c.approved),
    Invited: contacts.filter((c) => invitedIds.has(c.id)),
    Attended: contacts.filter((c) => c.attended),
    'CRM synced': contacts.filter((c) => c.lsqLeadId),
  };
  const drawers: Record<string, { title: string; subtitle: string; columns: string[]; rows: string[][]; notes?: string[] }> = {};
  for (const [label, list] of Object.entries(stageContacts)) {
    drawers[label] = {
      title: label,
      subtitle: `${list.length} of ${total} contacts — the records behind this stage`,
      columns: ['Contact', 'Account', 'Title', 'Score'],
      rows: list
        .slice()
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 50)
        .map((c) => [c.name, c.account, c.title, c.score !== null ? String(c.score) : '—']),
      notes: list.length > 50 ? [`Showing the top 50 of ${list.length} by score — export the full list from the Scoring tab.`] : undefined,
    };
  }

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <DashboardClient
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
        drawers={drawers}
      />
    </main>
  );
}
