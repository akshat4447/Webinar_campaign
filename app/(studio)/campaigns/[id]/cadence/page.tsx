import { ContactPagination } from '@/components/ui/ContactPagination';
import { contactQuery, contactPage, contactSearch, CONTACT_PAGE_SIZE } from '@/lib/contactPagination';
import { db } from '@/lib/db';
import { CadenceGroups } from './CadenceGroups';
import { CadenceHistory } from './CadenceHistory';
import { renderMergeFields } from '@/lib/cadence';
import { resolveStepTemplate, resolveStepTemplates } from '@/lib/messageTemplates';
import { getLinkedInProgressAction } from '@/lib/actions/linkedin';
import { getServerNow } from '@/lib/actions/clock';
import { normalizeLinkedInSlug, peopleSearchUrl } from '@/lib/linkedinUrl';
import { validateRenderedMessage } from '@/lib/messageValidation';
import { formatSpeakersSummary } from '@/lib/speakers';
import { isCampaignCompleted } from '@/lib/campaignLifecycle';
import { buildLandingPageUrl } from '@/lib/landingPageServer';
import { compareCadenceSteps } from '@/lib/stepSchedule';
import { registrationUrl } from '@/lib/registration';
import { appOrigin } from '@/lib/appOrigin';
import type { VerificationStatus } from '@/lib/apolloVerify';

export default async function SchedulePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{q?:string;page?:string}> }) {
  const { id } = await params;
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id } });
  const locked = isCampaignCompleted(campaign.status);
  const {q:rawQuery,page:rawPage}=await searchParams;
  const q=contactQuery(rawQuery);
  const where={campaignId:id,approved:true,...contactSearch(q)};
  const matching=await db.contact.count({where});
  const page=contactPage(rawPage,matching);

  // A completed webinar's cadence tab is a read-only record of what actually
  // ran — no timing edits, no add/remove step, no LinkedIn dispatch, no
  // automation-rule toggles. It also skips the (non-trivial) LinkedIn queue
  // construction below entirely, since nothing that data feeds (Fast-Runner,
  // bulk-confirm, the queue slide-over) renders in this view. See
  // lib/campaignLifecycle.ts.
  if (locked) {
    const [steps, sendCounts, sentRange] = await Promise.all([
      db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null } }).then((rows) => rows.sort(compareCadenceSteps)),
      db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
      db.cadenceSend.groupBy({
        by: ['stepKey'],
        where: { campaignId: id, status: 'sent' },
        _min: { sentAt: true },
        _max: { sentAt: true },
      }),
    ]);

    const countsByStep: Record<string, { sent: number; queued: number; failed: number }> = {};
    for (const row of sendCounts) {
      countsByStep[row.stepKey] ??= { sent: 0, queued: 0, failed: 0 };
      if (row.status === 'sent') countsByStep[row.stepKey].sent = row._count;
      if (row.status === 'queued') countsByStep[row.stepKey].queued = row._count;
      if (row.status === 'failed') countsByStep[row.stepKey].failed = row._count;
    }
    const sentRangeByStep: Record<string, { first: Date | null; last: Date | null }> = {};
    for (const row of sentRange) {
      sentRangeByStep[row.stepKey] = { first: row._min.sentAt, last: row._max.sentAt };
    }

    return (
      <main style={{ flex: 1, overflowY: 'auto' }}>
        <CadenceHistory
          steps={steps}
          countsByStep={countsByStep}
          sentRangeByStep={sentRangeByStep}
          automationRules={{
            stopOnRegistration: campaign.stopOnRegistration,
            stopOnDecline: campaign.stopOnDecline,
            oneClickSignup: campaign.oneClickSignup,
          }}
        />
      </main>
    );
  }

  const [steps, approvedContacts, sendCounts, linkedinTemplate, speakers, suppressionCount, registeredCount, campaignSuppressionCount] = await Promise.all([
    db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null } }).then((rows) => rows.sort(compareCadenceSteps)),
    db.contact.findMany({ where, orderBy: [{ score: {sort:'desc',nulls:'last'} }, { name: 'asc' }, {id:'asc'}], take:CONTACT_PAGE_SIZE,skip:(page-1)*CONTACT_PAGE_SIZE }),
    db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
    resolveStepTemplate(id, 'linkedin'),
    db.speaker.findMany({ where: { campaignId: id }, orderBy: { order: 'asc' } }),
    db.emailSuppression.count(),
    db.contact.count({ where: { campaignId: id, registeredAt: { not: null } } }),
    db.campaignSuppression.count({ where: { campaignId: id } }),
  ]);
  const speakersSummary = formatSpeakersSummary(speakers) || campaign.speakerName || '';
  // Personalized LinkedIn drafts win over the shared template, same as email.
  const personalizedLinkedIn = await db.personalizedMessage.findMany({
    where: { campaignId: id, stepKey: 'linkedin', contactId:{in:approvedContacts.map(c=>c.id)} },
    select: { contactId: true, body: true },
  });
  const personalizedByContact = new Map(personalizedLinkedIn.map((p) => [p.contactId, p.body]));
  const approvedCount = await db.contact.count({ where: { campaignId: id, approved: true } });
  const linkedinProgress = await getLinkedInProgressAction(id, approvedContacts.map(c=>c.id));

  // Messages a step can be pointed at: the shared library plus this campaign's
  // own overrides, keyed by routable channel so a step only offers messages it
  // could actually send.
  const selectableTemplates = await db.messageTemplate.findMany({
    where: { OR: [{ campaignId: null }, { campaignId: id }], hidden: false },
    orderBy: [{ campaignId: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, channel: true, campaignId: true },
  });
  const templateOptions: Record<string, { id: string; name: string; scope: string }[]> = {};
  for (const t of selectableTemplates) {
    (templateOptions[t.channel] ??= []).push({
      id: t.id,
      name: t.name,
      scope: t.campaignId ? 'this campaign' : 'library',
    });
  }

  // A step can be hard-pinned (CadenceStep.templateId) to a template that's
  // since been hidden from the library — it will never actually send
  // (lib/cadence.ts skips it as "Template is hidden"), but templateOptions
  // above deliberately excludes hidden templates, so a naive
  // opts.find(...) miss reads exactly like "no template pinned, using the
  // default" instead of "stuck on a dead reference". Look those up
  // separately so the UI can tell the two apart.
  const pinnedTemplateIds = [...new Set(steps.map((s) => s.templateId).filter((x): x is string => !!x))];
  const hiddenPinnedTemplates = pinnedTemplateIds.length
    ? await db.messageTemplate.findMany({
        where: { id: { in: pinnedTemplateIds }, hidden: true },
        select: { id: true, name: true },
      })
    : [];
  const hiddenPinnedTemplateNameById: Record<string, string> = {};
  for (const t of hiddenPinnedTemplates) hiddenPinnedTemplateNameById[t.id] = t.name;

  const serverNow = await getServerNow();

  // Every approved contact gets a LinkedIn touch. `slug` is their real profile
  // when one is on file (from the CSV's LinkedIn column or pasted in the queue);
  // `url` stays a name+company people-search so the flow still works without one.
  const baseLink = campaign.registrationLink ?? '';
  const linkedinQueue = approvedContacts.map((c) => {
    const personalizedBody = personalizedByContact.get(c.id);
    const effectiveContactLink = campaign.registrationLink
      ? buildLandingPageUrl({
          landingPageUrl: campaign.registrationLink,
          campaign,
          contact: c,
          channel: 'linkedin',
          apiOrigin: appOrigin(),
        })
      : campaign.oneClickSignup
        ? registrationUrl(appOrigin(), campaign.id, c.id, 'linkedin')
        : campaign.zoomLink || baseLink;

    // LinkedIn sends are human-reviewed (copy/paste, or a labeled bot
    // assisted runner) rather than auto-sent like email, so this doesn't silently
    // substitute the template the way lib/cadence.ts does for email — it just
    // flags a broken personalized draft so the human doesn't ship it unaware.
    const personalizedValid = personalizedBody ? validateRenderedMessage(null, personalizedBody, false, effectiveContactLink).valid : true;
    const fallback = linkedinTemplate
      ? renderMergeFields(linkedinTemplate.body, {
          firstName: c.name.split(' ')[0] || c.name,
          company: c.account,
          topic: campaign.name,
          link: effectiveContactLink,
          date: campaign.date,
          speaker: speakersSummary,
        })
      : `Hi ${c.name.split(' ')[0]} — noticed ${c.account}'s work in this space. We're running ${campaign.name} and thought it'd be relevant.`;
    return {
      id: c.id,
      name: c.name,
      title: c.title,
      account: c.account,
      url: peopleSearchUrl(c.name, c.account),
      slug: normalizeLinkedInSlug(c.linkedinId),
      personalized: !!personalizedBody,
      personalizedInvalid: !!personalizedBody && !personalizedValid,
      message: personalizedBody && personalizedValid ? personalizedBody : fallback,
      checkStatus: (c.linkedinCheckStatus as VerificationStatus | null) ?? null,
      checkNote: c.linkedinCheckNote ?? null,
    };
  });

  // Apollo-verified first, unchecked next, failed verification last — the
  // queue is consumed top-down, so the safest sends are always the closest.
  const CHECK_ORDER: Record<string, number> = { verified: 0 };
  linkedinQueue.sort((a, b) => {
    const ra = a.checkStatus ? CHECK_ORDER[a.checkStatus] ?? 2 : 1;
    const rb = b.checkStatus ? CHECK_ORDER[b.checkStatus] ?? 2 : 1;
    if (ra !== rb) return ra - rb;
    return 0; // preserve original approved-contacts ordering within a band
  });

  const countsByStep: Record<string, { sent: number; queued: number; failed: number }> = {};
  for (const row of sendCounts) {
    countsByStep[row.stepKey] ??= { sent: 0, queued: 0, failed: 0 };
    if (row.status === 'sent') countsByStep[row.stepKey].sent = row._count;
    if (row.status === 'queued') countsByStep[row.stepKey].queued = row._count;
    if (row.status === 'failed') countsByStep[row.stepKey].failed = row._count;
  }

  const resolvedTemplates = await resolveStepTemplates(id, steps.map((s) => s.key));
  const resolvedTemplateIdByStep: Record<string, string> = {};
  for (const [key, template] of resolvedTemplates) {
    if (template?.id) resolvedTemplateIdByStep[key] = template.id;
  }

  return (
    <main style={{ flex: 1, overflowY: 'auto' }}>
      <ContactPagination path={`/campaigns/${id}/cadence`} page={page} total={matching} q={q} label="LinkedIn recipients" />
      <CadenceGroups
        campaignId={id}
        webinarName={campaign.name}
        steps={steps}
        countsByStep={countsByStep}
        templateOptions={templateOptions}
        hiddenPinnedTemplateNameById={hiddenPinnedTemplateNameById}
        resolvedTemplateIdByStep={resolvedTemplateIdByStep}
        launchAtIso={(campaign.launchedAt ?? new Date(serverNow)).toISOString()}
        webinarAtIso={campaign.scheduledAt?.toISOString() ?? null}
        webinarDate={campaign.date}
        approvedCount={approvedCount}
        registeredCount={registeredCount}
        suppressionCount={suppressionCount}
        campaignSuppressionCount={campaignSuppressionCount}
        linkedinQueue={linkedinQueue}
        initialLinkedInProgress={linkedinProgress}
        automationRules={{
          stopOnRegistration: campaign.stopOnRegistration,
          stopOnDecline: campaign.stopOnDecline,
          oneClickSignup: campaign.oneClickSignup,
          suppressionPreflight: campaign.suppressionPreflight,
        }}
      />
    </main>
  );
}
