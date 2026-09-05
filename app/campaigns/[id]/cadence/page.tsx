import { db } from '@/lib/db';
import { CadenceGroups } from './CadenceGroups';
import { LinkedInPanel } from './LinkedInPanel';
import { LaunchCadenceCard } from './LaunchCadenceCard';
import { renderMergeFields } from '@/lib/cadence';
import { sendModeLabel } from '@/lib/sendGuard';
import { getLinkedInProgressAction } from '@/lib/actions/linkedin';
import { getServerNow } from '@/lib/actions/clock';
import { normalizeLinkedInSlug, peopleSearchUrl } from '@/lib/linkedinUrl';
import { validateRenderedMessage } from '@/lib/messageValidation';
import type { VerificationStatus } from '@/lib/apolloVerify';

export default async function SchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [campaign, steps, approvedContacts, sendCounts, linkedinTemplate] = await Promise.all([
    db.campaign.findUniqueOrThrow({ where: { id } }),
    db.cadenceStep.findMany({ where: { campaignId: id, removedAt: null } }),
    db.contact.findMany({ where: { campaignId: id, approved: true }, orderBy: [{ score: 'desc' }, { name: 'asc' }] }),
    db.cadenceSend.groupBy({ by: ['stepKey', 'status'], where: { campaignId: id }, _count: true }),
    db.template.findUnique({ where: { campaignId_key: { campaignId: id, key: 'linkedin' } } }),
  ]);
  // Personalized LinkedIn drafts win over the shared template, same as email.
  const personalizedLinkedIn = await db.personalizedMessage.findMany({
    where: { campaignId: id, stepKey: 'linkedin' },
    select: { contactId: true, body: true },
  });
  const personalizedByContact = new Map(personalizedLinkedIn.map((p) => [p.contactId, p.body]));
  const approvedCount = await db.contact.count({ where: { campaignId: id, approved: true } });
  const linkedinProgress = await getLinkedInProgressAction(id);

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
  const serverNow = await getServerNow();

  // Every approved contact gets a LinkedIn touch. `slug` is their real profile
  // when one is on file (from the CSV's LinkedIn column or pasted in the queue);
  // `url` stays a name+company people-search so the flow still works without one.
  const link = campaign.registrationLink ?? '';
  const linkedinQueue = approvedContacts.map((c) => {
    const personalizedBody = personalizedByContact.get(c.id);
    // LinkedIn sends are human-reviewed (copy/paste, or a labeled bot
    // simulation) rather than auto-sent like email, so this doesn't silently
    // substitute the template the way lib/cadence.ts does for email — it just
    // flags a broken personalized draft so the human doesn't ship it unaware.
    const personalizedValid = personalizedBody ? validateRenderedMessage(null, personalizedBody, false, link).valid : true;
    const fallback = linkedinTemplate
      ? renderMergeFields(linkedinTemplate.body, { firstName: c.name.split(' ')[0] || c.name, company: c.account, topic: campaign.name, link })
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
      // An invalid personalized draft is treated the same as "none exists" —
      // the queue shows the safe template instead, matching what the email
      // send path in lib/cadence.ts actually does, rather than surfacing a
      // draft that's missing its link or has a leftover {{token}} in it.
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

  return (
    <main style={{ flex: 1, overflowY: 'auto', padding: '28px 36px 48px 36px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 300px)', gap: 20, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CadenceGroups
            campaignId={id}
            steps={steps}
            countsByStep={countsByStep}
            templateOptions={templateOptions}
            launchAtIso={(campaign.simulatedNow ?? new Date(serverNow)).toISOString()}
            webinarAtIso={campaign.scheduledAt?.toISOString() ?? null}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, position: 'sticky', top: 0 }}>
          <LinkedInPanel
            campaignId={id}
            queue={linkedinQueue}
            initialProgress={linkedinProgress}
          />

          <LaunchCadenceCard campaignId={id} approvedCount={approvedCount} cadenceStatus={campaign.cadenceStatus} sendMode={sendModeLabel()} />
        </div>
      </div>
    </main>
  );
}
