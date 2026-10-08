import { ContactPagination } from '@/components/ui/ContactPagination';
import { contactQuery, contactPage, contactSearch, CONTACT_PAGE_SIZE } from '@/lib/contactPagination';
import { db } from '@/lib/db';
import { PersonalizeClient } from './PersonalizeClient';
import { MessagingHistory } from './MessagingHistory';
import { isLinkStale } from '@/lib/personalization';
import { resolveStepTemplates } from '@/lib/messageTemplates';
import { normalizeChannel } from '@/lib/channels';
import { computePersonalizeReadiness } from '@/lib/cadenceReadiness';
import { formatSpeakersSummary } from '@/lib/speakers';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';
import { DEFAULT_PERSONALIZATION_FIELDS } from '@/lib/messagingOptions';
import { compareCadenceSteps } from '@/lib/stepSchedule';

export default async function PersonalizePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ step?: string; q?: string; page?: string }> }) {
  const { id } = await params;
  const { step: stepParam, q: rawQuery, page: rawPage } = await searchParams;
  const q = contactQuery(rawQuery);
  const contactWhere = { campaignId: id, approved: true, ...contactSearch(q) };
  const [matchingContacts,totalApproved] = await Promise.all([db.contact.count({where:contactWhere}),db.contact.count({where:{campaignId:id,approved:true}})]);
  const page = contactPage(rawPage,matchingContacts);

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });

  // A completed webinar's messaging tab is a historical record, not a live
  // editor: no drafts get auto-generated, no copy can be edited or
  // regenerated, and every figure shown must come from what actually sent
  // (CadenceSend/PersonalizedMessage), never from the live-editing queries
  // below. See lib/campaignLifecycle.ts.
  if (isCampaignCompleted(campaign.status)) {
    // The step picker needs coverage counts for every step, but not the full
    // send/message rows behind them — a groupBy count is enough for that.
    // Full rows (and their message bodies) are only fetched below, once, and
    // only for whichever step is actually selected.
    const [rawSteps, stepSendCounts] = await Promise.all([
      db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null } }),
      db.cadenceSend.groupBy({
        by: ['stepKey', 'status'],
        where: { campaignId: id },
        _count: { id: true },
      }),
    ]);
    const steps = [...rawSteps].sort(compareCadenceSteps);

    const countsByStep: Record<string, { sent: number; queued: number; failed: number; skipped: number }> = {};
    for (const sc of stepSendCounts) {
      countsByStep[sc.stepKey] ??= { sent: 0, queued: 0, failed: 0, skipped: 0 };
      if (sc.status === 'sent') countsByStep[sc.stepKey].sent += sc._count.id;
      else if (sc.status === 'queued') countsByStep[sc.stepKey].queued += sc._count.id;
      else if (sc.status === 'failed') countsByStep[sc.stepKey].failed += sc._count.id;
      else if (sc.status === 'skipped') countsByStep[sc.stepKey].skipped += sc._count.id;
    }

    const stepOptions = steps.map((s) => ({
      key: s.key,
      label: s.title,
      channel: normalizeChannel(s.channel),
      counts: countsByStep[s.key] ?? { sent: 0, queued: 0, failed: 0, skipped: 0 },
    }));

    const activeStepKey = stepOptions.some((s) => s.key === stepParam) ? (stepParam as string) : stepOptions[0]?.key ?? null;

    let rows: {
      contactId: string;
      contactName: string;
      channel: ReturnType<typeof normalizeChannel>;
      subject: string | null;
      body: string;
      sentAt: Date | null;
      status: string;
      error: string | null;
    }[] = [];


    if (activeStepKey) {
      const activeStepMeta = steps.find((s) => s.key === activeStepKey);
      const channel = normalizeChannel(activeStepMeta?.channel);

      // Scoped to the one step actually being rendered — not every step's
      // sends/messages for every contact, which is what made this branch
      // expensive on campaigns with a long cadence.
      const stepSends = await db.cadenceSend.findMany({
        where:{campaignId:id,stepKey:activeStepKey},orderBy:{sentAt:'desc'},take:500,
        select:{contactId:true,sentAt:true,status:true,error:true,renderedSubject:true,renderedBody:true,deliveryOutcome:true,contact:{select:{name:true}}},
      });
      rows = stepSends.map(send=>({contactId:send.contactId,contactName:send.contact.name,channel,subject:send.renderedSubject,
        body:send.renderedBody ?? 'Content was not recorded for this historical delivery.',sentAt:send.sentAt,
        status:send.status === 'sent' ? (send.deliveryOutcome === 'queued' ? 'provider_queued' : 'accepted') : send.status,error:send.error}));
    }

    return (
      <main className="lsq-msg-main">
        <div className="lsq-page">
          <MessagingHistory
            campaignId={id}
            steps={stepOptions}
            activeStepKey={activeStepKey}
            rows={rows}
          />
        </div>
      </main>
    );
  }

  const [rawCadenceSteps, approvedContacts, speakers, sendCounts] = await Promise.all([
    db.cadenceStep.findMany({
      where: { campaignId: id, removedAt: null, enabled: true },
    }),
    db.contact.findMany({
      where: contactWhere,
      orderBy: [{ score: {sort:'desc',nulls:'last'} }, { name: 'asc' }, {id:'asc'}],
      take: CONTACT_PAGE_SIZE, skip: (page - 1) * CONTACT_PAGE_SIZE,
    }),
    db.speaker.findMany({ where: { campaignId: id }, orderBy: { order: 'asc' } }),
    db.cadenceSend.groupBy({
      by: ['stepKey', 'status'],
      where: { campaignId: id },
      _count: { id: true },
    }),
  ]);
  const cadenceSteps = [...rawCadenceSteps].sort(compareCadenceSteps);

  const countsByStep: Record<string, { sent: number; queued: number; failed: number }> = {};
  for (const sc of sendCounts) {
    if (!countsByStep[sc.stepKey]) {
      countsByStep[sc.stepKey] = { sent: 0, queued: 0, failed: 0 };
    }
    if (sc.status === 'sent') countsByStep[sc.stepKey].sent += sc._count.id;
    else if (sc.status === 'queued') countsByStep[sc.stepKey].queued += sc._count.id;
    else if (sc.status === 'failed') countsByStep[sc.stepKey].failed += sc._count.id;
  }

  // Falls back to the legacy single-speaker mirror for campaigns with no
  // Speaker rows yet, but otherwise reflects the full panel/co-speaker roster
  // — not just the primary — in every {{speaker}}/{{speakerName}}/{{speakers}}
  // preview and templatized-send merge on this page.
  const speakersSummary = formatSpeakersSummary(speakers) || campaign.speakerName || undefined;

  // Render ONLY steps that were created and enabled for this campaign
  const rawKeys: string[] = cadenceSteps.length > 0 ? cadenceSteps.map((s) => s.key) : ['invite'];
  const stepKeys = stepParam && rawKeys.includes(stepParam) ? rawKeys : rawKeys;
  const resolvedByKey = await resolveStepTemplates(id, stepKeys);
  const templates = stepKeys.map((key) => ({ key, resolved: resolvedByKey.get(key) ?? null }));

  const available = templates
    .filter((t) => t.resolved && !t.resolved.hidden)
    .map((t) => ({
      key: t.key,
      label: t.resolved!.label,
      channel: t.resolved!.channel,
      hasSubject: t.resolved!.hasSubject,
      subject: t.resolved!.subject,
      body: t.resolved!.body,
      isSent: (countsByStep[t.key]?.sent ?? 0) > 0,
      sentCount: countsByStep[t.key]?.sent ?? 0,
      queuedCount: countsByStep[t.key]?.queued ?? 0,
    }));

  if (available.length === 0) {
    return (
      <main className="lsq-msg-main">
        <div className="lsq-page">
          <div className="lsq-card lsq-empty">
            <p className="lsq-empty__title">No Messages To Edit</p>
            <p className="lsq-empty__body">None of this webinar&apos;s enabled cadence steps has copy to write. Enable a step on the Cadence tab.</p>
          </div>
        </div>
      </main>
    );
  }

  const activeStep = available.find((t) => t.key === stepParam) ?? available[0];
  const activeCadenceStep = cadenceSteps.find((s) => s.key === activeStep.key);
  const stepMode = activeCadenceStep?.mode ?? (campaign.msgMode === 'templatized' ? 'template' : 'ai');
  const stepTemplateId = activeCadenceStep?.templateId ?? null;
  const normalizedChannel = normalizeChannel(activeStep.channel);

  const selectableTemplates = await db.messageTemplate.findMany({
    where: {
      channel: normalizedChannel,
      status: { in: ['ready', 'draft'] },
      // Matches the Cadence tab's equivalent query — a hidden template can
      // never actually send (lib/cadence.ts skips it as "Template is
      // hidden"), so it must not be offered as a selectable Fixed Template
      // here either.
      hidden: false,
      OR: [{ campaignId: id }, { campaignId: null }],
    },
    orderBy: [{ campaignId: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, subject: true, body: true, campaignId: true, key: true },
  });

  // Drafts are only ever generated by an explicit operator action (the Generate
  // button). Rendering this page used to call the AI for every approved contact on
  // first view: a GET with a cost, a minute-long blocking render, and a surprise
  // for anyone who just opened the tab.
  const messages = await db.personalizedMessage.findMany({
    where: { campaignId: id, stepKey: activeStep.key, contactId: {in:approvedContacts.map(c=>c.id)} },
  });
  const byContact = new Map(messages.map((m) => [m.contactId, m]));
  const totalDrafted = await db.personalizedMessage.count({where:{campaignId:id,stepKey:activeStep.key,contact:{approved:true}}});

  // Counts per step so the step picker can show coverage at a glance.
  const grouped = await db.personalizedMessage.groupBy({ by: ['stepKey'], where: { campaignId: id }, _count: true });
  const countByStep = Object.fromEntries(grouped.map((g) => [g.stepKey, g._count]));

  const currentLink = campaign.registrationLink || campaign.zoomLink || '';
  const readiness = await computePersonalizeReadiness(id);

  const rows = approvedContacts.map((c) => {
    const m = byContact.get(c.id);
    return {
      contactId: c.id,
      name: c.name,
      title: c.title,
      account: c.account,
      seniority: c.seniority,
      function: c.function,
      vertical: c.vertical,
      score: c.score,
      personaNote: c.personaNote,
      message: m
        ? {
            id: m.id,
            subject: m.subject,
            body: m.body,
            rationale: m.rationale,
            status: m.status,
            linkStale: isLinkStale(m.linkUsed, currentLink),
            isOutdated: m.status !== 'edited' && m.generatedAt < campaign.updatedAt,
          }
        : null,
    };
  });

  return (
    <main className="lsq-msg-main">
      <div className="lsq-page">
      <ContactPagination path={`/campaigns/${id}/messaging`} page={page} total={matchingContacts} q={q} params={{step:activeStep.key}} label="message recipients" />
      <PersonalizeClient
        // Remount on step change: the editor holds the recipient copy in local
        // state, and a soft navigation between steps swaps the props without
        // reseeding it — which would show the previous step's messages.
        key={`${activeStep.key}:${page}:${q}`}
        campaignId={id}
        campaignName={campaign.name}
        campaignDate={campaign.date}
        speakerName={speakersSummary}
        speakers={speakers.map((s) => ({ name: s.name, title: s.title, company: s.company }))}
        hasDescription={!!campaign.description}
        steps={available.map((t) => ({
          key: t.key,
          label: t.label,
          channel: t.channel,
          count: countByStep[t.key] ?? 0,
          isSent: t.isSent,
          sentCount: t.sentCount,
          queuedCount: t.queuedCount,
        }))}
        activeStepKey={activeStep.key}
        activeStepLabel={activeStep.label}
        activeChannel={normalizeChannel(activeStep.channel)}
        isSent={activeStep.isSent}
        sentCount={activeStep.sentCount}
        queuedCount={activeStep.queuedCount}
        stepMode={stepMode === 'template' ? 'template' : 'ai'}
        stepTemplateId={stepTemplateId}
        selectableTemplates={selectableTemplates.map((st) => ({
          id: st.id,
          name: st.name,
          subject: st.subject,
          body: st.body,
          isDefault: !st.campaignId || !!st.key,
        }))}
        personalizationFields={
          campaign.personalizationFields
            ? campaign.personalizationFields.split(',').map((f) => f.trim()).filter(Boolean)
            : [...DEFAULT_PERSONALIZATION_FIELDS]
        }
        templateSubject={activeStep.hasSubject ? activeStep.subject : null}
        templateBody={activeStep.body}
        msgMode={campaign.msgMode === 'templatized' ? 'templatized' : 'ai'}
        rows={rows}
        totalApproved={totalApproved}
        totalDrafted={totalDrafted}
        currentLink={currentLink}
        personalizationPrompt={campaign.personalizationPrompt}
        brief={campaign.brief ?? ''}
        aiInstructions={campaign.aiInstructions ?? ''}
        tone={campaign.tone}
        msgLength={campaign.msgLength}
        confirmThreshold={campaign.scoringThreshold}
        statusNotice={
          <div className={`lsq-banner lsq-banner--${!readiness.ok ? 'warning' : readiness.generatedTotal === 0 && campaign.msgMode === 'ai' ? 'neutral' : 'success'}`} role="status">
            <div>
              {!readiness.ok ? (
                <>
                  <p className="lsq-banner__title">{readiness.problems.length} {readiness.problems.length === 1 ? 'Issue Needs' : 'Issues Need'} Fixing</p>
                  <ul style={{ margin: 0, paddingLeft: 'var(--space-16)' }}>
                    {readiness.problems.slice(0, 4).map((p) => (
                      <li key={p} className="lsq-banner__body">{p}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="lsq-banner__body">
                  {campaign.msgMode === 'templatized'
                    ? `Templates are ready. ${available.length} ${available.length === 1 ? 'step merges' : 'steps merge'} automatically on send.`
                    : readiness.generatedTotal === 0
                      ? `No drafts yet. ${totalApproved} approved ${totalApproved === 1 ? 'contact is' : 'contacts are'} ready for AI drafts.`
                      : `${readiness.generatedTotal} ${readiness.generatedTotal === 1 ? 'draft is' : 'drafts are'} ready across ${available.length} ${available.length === 1 ? 'step' : 'steps'}.`}
                </p>
              )}
            </div>
          </div>
        }
      />
      </div>
    </main>
  );
}
